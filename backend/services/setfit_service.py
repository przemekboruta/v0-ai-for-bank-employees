"""
SetFit Service - Few-shot classification with SetFit.

Trening, predykcja, zapis/odczyt modeli.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from config import (
    SETFIT_NUM_ITERATIONS,
    SETFIT_BATCH_SIZE,
    MODELS_DIR,
    LOCAL_ENCODER_PATH,
    ENCODER_MODEL_NAME,
)

logger = logging.getLogger(__name__)


def _compute_category_metrics(
    predictions: list[int],
    true_labels: list[int],
    label_map: dict[int, str],
) -> list[dict]:
    """Compute per-category precision, recall, F1."""
    all_cats = set(predictions) | set(true_labels)
    metrics = []
    for cat_idx in sorted(all_cats):
        tp = sum(1 for p, t in zip(predictions, true_labels) if p == cat_idx and t == cat_idx)
        fp = sum(1 for p, t in zip(predictions, true_labels) if p == cat_idx and t != cat_idx)
        fn = sum(1 for p, t in zip(predictions, true_labels) if p != cat_idx and t == cat_idx)
        support = sum(1 for t in true_labels if t == cat_idx)

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

        metrics.append({
            "categoryId": str(cat_idx),
            "categoryName": label_map.get(cat_idx, f"Category {cat_idx}"),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "support": support,
        })
    return metrics


def _get_backbone() -> str:
    """Return the backbone model path for SetFit."""
    if LOCAL_ENCODER_PATH and Path(LOCAL_ENCODER_PATH).exists():
        return LOCAL_ENCODER_PATH
    return ENCODER_MODEL_NAME


def _train_sync(
    categories: list[dict],
    backbone_model_path: str,
    num_iterations: int,
    batch_size: int,
) -> tuple:
    """Synchronous training - runs in thread via asyncio.to_thread."""
    import random
    from datasets import Dataset
    from setfit import SetFitModel, SetFitTrainer

    # Build training data
    texts = []
    labels = []
    label_map: dict[int, str] = {}

    for idx, cat in enumerate(categories):
        label_map[idx] = cat["name"]
        for example in cat.get("examples", []):
            texts.append(example)
            labels.append(idx)

    if len(texts) == 0:
        raise ValueError("No training examples provided")

    # Stratified train/val split — hold out ~20% per category for validation
    # Only if we have enough examples (>= 2 per category for at least some categories)
    train_texts, train_labels = [], []
    val_texts, val_labels = [], []
    can_validate = False

    examples_by_cat: dict[int, list[str]] = {}
    for t, l in zip(texts, labels):
        examples_by_cat.setdefault(l, []).append(t)

    for cat_idx, cat_examples in examples_by_cat.items():
        if len(cat_examples) >= 5:
            # Hold out ~20% (at least 1) for validation
            shuffled = cat_examples.copy()
            random.shuffle(shuffled)
            val_count = max(1, len(shuffled) // 5)
            val_texts.extend(shuffled[:val_count])
            val_labels.extend([cat_idx] * val_count)
            train_texts.extend(shuffled[val_count:])
            train_labels.extend([cat_idx] * (len(shuffled) - val_count))
            can_validate = True
        else:
            # Too few examples — use all for training
            train_texts.extend(cat_examples)
            train_labels.extend([cat_idx] * len(cat_examples))

    train_dataset = Dataset.from_dict({"text": train_texts, "label": train_labels})

    logger.info(
        f"Training SetFit: {len(train_texts)} train + {len(val_texts)} val examples, "
        f"{len(categories)} categories, backbone={backbone_model_path}"
    )

    model = SetFitModel.from_pretrained(backbone_model_path)
    trainer = SetFitTrainer(
        model=model,
        train_dataset=train_dataset,
        num_iterations=num_iterations,
        batch_size=batch_size,
    )
    trainer.train()

    # Evaluate
    category_metrics = []
    if can_validate and len(val_texts) > 0:
        # Validation accuracy (held-out data)
        preds = model.predict(val_texts)
        pred_list = [int(p) for p in preds]
        correct = sum(1 for p, l in zip(pred_list, val_labels) if p == l)
        accuracy = correct / len(val_labels)
        accuracy_type = "validation"
        category_metrics = _compute_category_metrics(pred_list, val_labels, label_map)
        logger.info(f"Training complete. Validation accuracy: {accuracy:.2%} ({len(val_texts)} held-out examples)")
    else:
        # Fallback: training accuracy with disclaimer
        preds = model.predict(texts)
        pred_list = [int(p) for p in preds]
        correct = sum(1 for p, l in zip(pred_list, labels) if p == l)
        accuracy = correct / len(labels) if labels else 0.0
        accuracy_type = "training"
        category_metrics = _compute_category_metrics(pred_list, labels, label_map)
        logger.info(f"Training complete. Training accuracy (in-sample, few examples): {accuracy:.2%}")

    return model, label_map, accuracy, accuracy_type, category_metrics


async def train(
    categories: list[dict],
    backbone_model_path: str = "",
    num_iterations: int = SETFIT_NUM_ITERATIONS,
    batch_size: int = SETFIT_BATCH_SIZE,
) -> tuple:
    """Train a SetFit model. Returns (model, label_map, accuracy, accuracy_type, category_metrics)."""
    backbone = backbone_model_path or _get_backbone()

    model, label_map, accuracy, accuracy_type, category_metrics = await asyncio.to_thread(
        _train_sync, categories, backbone, num_iterations, batch_size
    )
    return model, label_map, accuracy, accuracy_type, category_metrics


def _predict_sync(model, texts: list[str], label_map: dict[int, str]) -> tuple[list[dict], bool]:
    """Synchronous prediction. Returns (results, confidence_available)."""
    import torch

    preds = model.predict(texts)
    # Get probabilities
    try:
        probs = model.predict_proba(texts)
    except Exception:
        probs = None
        logger.warning("predict_proba not available — confidence scores will be estimated")

    confidence_available = probs is not None

    results = []
    for i, text in enumerate(texts):
        pred_idx = int(preds[i])
        cat_name = label_map.get(pred_idx, f"Category {pred_idx}")

        doc = {
            "id": str(i),
            "text": text,
            "categoryId": str(pred_idx),
            "categoryName": cat_name,
        }

        if probs is not None:
            if isinstance(probs, torch.Tensor):
                row_probs = probs[i]
                confidence = float(row_probs.max())
                # All probabilities for smart sampling
                all_probs = [round(float(p), 4) for p in row_probs]
                doc["allProbabilities"] = all_probs
                # Margin: difference between top-2 probabilities (low = uncertain)
                if row_probs.numel() >= 2:
                    sorted_probs = torch.sort(row_probs, descending=True).values
                    margin = float(sorted_probs[0] - sorted_probs[1])
                    doc["margin"] = round(margin, 4)
                else:
                    doc["margin"] = 1.0
            else:
                if hasattr(probs[i], '__iter__'):
                    row_probs = list(probs[i])
                    confidence = float(max(row_probs))
                    doc["allProbabilities"] = [round(float(p), 4) for p in row_probs]
                    sorted_p = sorted(row_probs, reverse=True)
                    doc["margin"] = round(sorted_p[0] - sorted_p[1], 4) if len(sorted_p) >= 2 else 1.0
                else:
                    confidence = float(probs[i])
                    doc["margin"] = 1.0
        else:
            confidence = -1.0
            doc["margin"] = -1.0

        doc["confidence"] = round(confidence, 4)
        results.append(doc)

    return results, confidence_available


async def predict(model, texts: list[str], label_map: dict[int, str]) -> tuple[list[dict], bool]:
    """Classify texts using a trained model. Returns (list of ClassifiedDocument dicts, confidence_available)."""
    return await asyncio.to_thread(_predict_sync, model, texts, label_map)


def save_model(model, label_map: dict[int, str], metadata: dict, model_id: str) -> Path:
    """Save model to filesystem."""
    model_dir = MODELS_DIR / model_id
    model_dir.mkdir(parents=True, exist_ok=True)

    model.save_pretrained(str(model_dir))

    meta = {
        "modelId": model_id,
        "labelMap": {str(k): v for k, v in label_map.items()},
        **metadata,
        "savedAt": datetime.now(timezone.utc).isoformat(),
    }
    with open(model_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    logger.info(f"Model saved: {model_dir}")
    return model_dir


def load_model(model_id: str) -> tuple:
    """Load model from filesystem. Returns (model, label_map, metadata)."""
    from setfit import SetFitModel

    model_dir = MODELS_DIR / model_id
    if not model_dir.exists():
        raise FileNotFoundError(f"Model not found: {model_id}")

    model = SetFitModel.from_pretrained(str(model_dir))

    meta_path = model_dir / "metadata.json"
    with open(meta_path, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    label_map = {int(k): v for k, v in metadata.get("labelMap", {}).items()}

    return model, label_map, metadata
