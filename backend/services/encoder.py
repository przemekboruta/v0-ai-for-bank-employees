"""
Encoder Service - wiele modeli z opcjonalnym prefixem.
Ładuje modele z listy ENCODER_MODELS i generuje embeddingi (konkatenacja wektorów).
Dla każdego modelu do embeddowania trafi: prefix + tekst (jeśli prefix podany).
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

import numpy as np
import torch
from transformers import AutoTokenizer, AutoModel

if TYPE_CHECKING:
    pass

from config import (
    ENCODER_BATCH_SIZE,
    ENCODER_MAX_SEQ_LENGTH,
    ENCODER_DEVICE,
    ENCODER_MODELS,
)

logger = logging.getLogger(__name__)


class EncoderService:
    """
    Serwis enkodowania tekstów wieloma modelami.
    Dla każdego modelu można ustawić opcjonalny prefix (do embeddowania: prefix + tekst).
    Wektory z modeli są konkatenowane w jeden wektor.
    """

    _instance: EncoderService | None = None

    def __init__(self) -> None:
        self.encoder_configs = ENCODER_MODELS
        self.model_name = ", ".join(c["model"] for c in self.encoder_configs)
        self.batch_size = ENCODER_BATCH_SIZE
        self.max_seq_length = ENCODER_MAX_SEQ_LENGTH
        self._loaded_models: list[dict[str, Any]] = []
        self._loaded = False
        self._model_cache: dict[str, dict[str, Any]] = {}

    @classmethod
    def get_instance(cls) -> EncoderService:
        if cls._instance is None:
            cls._instance = EncoderService()
        return cls._instance

    def _get_device(self) -> torch.device:
        if ENCODER_DEVICE == "auto":
            return torch.device("cuda" if torch.cuda.is_available() else "cpu")
        return torch.device(ENCODER_DEVICE)

    def load(self) -> None:
        """Ładuje wszystkie modele z listy. Wywoływane przy starcie lub przy pierwszym encode()."""
        if self._loaded:
            return

        device = self._get_device()
        logger.info(f"Urządzenie: {device}")

        for cfg in self.encoder_configs:
            name = cfg["model"]
            prefix = cfg.get("prefix") or ""
            logger.info(f"Ładowanie modelu encoder: {name}" + (f" (prefix: {prefix!r})" if prefix else ""))
            start = time.time()
            tokenizer = AutoTokenizer.from_pretrained(name)
            model = AutoModel.from_pretrained(name)
            model.to(device)
            model.eval()
            elapsed = time.time() - start
            logger.info(f"Model {name} załadowany w {elapsed:.1f}s")
            self._loaded_models.append(
                {
                    "model_name": name,
                    "prefix": prefix,
                    "tokenizer": tokenizer,
                    "model": model,
                    "device": device,
                }
            )
        self._loaded = True

    def _mean_pooling(
        self,
        model_output: torch.Tensor,
        attention_mask: torch.Tensor,
    ) -> torch.Tensor:
        """Mean pooling - uwzględnia attention mask."""
        token_embeddings = model_output.last_hidden_state
        input_mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
        return torch.sum(token_embeddings * input_mask_expanded, 1) / torch.clamp(input_mask_expanded.sum(1), min=1e-9)

    def _encode_single(
        self,
        enc: dict[str, Any],
        texts: list[str],
        bs: int,
        normalize: bool,
        progress_callback: callable | None,
        total_models: int,
        model_index: int,
    ) -> np.ndarray:
        prefix = enc.get("prefix") or ""
        if prefix:
            sep = " " if not prefix.endswith(" ") else ""
            texts = [prefix + sep + t for t in texts]
        tokenizer = enc["tokenizer"]
        model = enc["model"]
        device = enc["device"]
        all_embeddings: list[np.ndarray] = []
        total_batches = (len(texts) + bs - 1) // bs
        n_texts = len(texts)

        for i in range(0, n_texts, bs):
            batch_texts = texts[i : i + bs]
            batch_num = i // bs + 1
            encoded = tokenizer(
                batch_texts,
                padding=True,
                truncation=True,
                max_length=self.max_seq_length,
                return_tensors="pt",
            )
            encoded = {k: v.to(device) for k, v in encoded.items()}
            output = model(**encoded)
            embeddings = self._mean_pooling(output, encoded["attention_mask"])
            if normalize:
                embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
            all_embeddings.append(embeddings.cpu().numpy())
            if progress_callback:
                try:
                    processed = min(i + bs, n_texts)
                    if total_models > 1:
                        total_batches_all = total_batches * total_models
                        batch_num_all = model_index * total_batches + batch_num
                        progress_callback(batch_num_all, total_batches_all, processed, n_texts)
                    else:
                        progress_callback(batch_num, total_batches, processed, n_texts)
                except Exception as e:
                    logger.warning(f"Progress callback error: {e}")
        return np.vstack(all_embeddings)

    @torch.no_grad()
    def encode(
        self,
        texts: list[str],
        batch_size: int | None = None,
        normalize: bool = True,
        progress_callback: callable | None = None,
    ) -> np.ndarray:
        """
        Generuje embeddingi dla listy tekstów (konkatenacja z wszystkich modeli).

        Dla każdego modelu: do embeddowania trafia (prefix + tekst). Wektory są łączone wzdłuż osi 1.
        """
        if not self._loaded:
            self.load()

        bs = batch_size or self.batch_size
        parts: list[np.ndarray] = []
        total_models = len(self._loaded_models)

        for idx, enc in enumerate(self._loaded_models):
            part = self._encode_single(
                enc,
                texts,
                bs,
                normalize,
                progress_callback if total_models == 1 else None,
                total_models,
                idx,
            )
            parts.append(part)

        result = np.concatenate(parts, axis=1)
        logger.info(f"Zakodowano {len(texts)} tekstow -> shape {result.shape}")
        return result

    def _ensure_model_loaded(self, model_name: str) -> dict[str, Any]:
        """Load a single model by name (cached). Returns enc dict for _encode_single."""
        if model_name in self._model_cache:
            return self._model_cache[model_name]
        device = self._get_device()
        logger.info(f"Ładowanie modelu encoder (na życzenie): {model_name}")
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = AutoModel.from_pretrained(model_name)
        model.to(device)
        model.eval()
        enc = {
            "model_name": model_name,
            "prefix": "",
            "tokenizer": tokenizer,
            "model": model,
            "device": device,
        }
        self._model_cache[model_name] = enc
        return enc

    @torch.no_grad()
    def encode_single_model(
        self,
        texts: list[str],
        model_name: str,
        prefix: str = "",
        batch_size: int | None = None,
        normalize: bool = True,
        progress_callback: callable | None = None,
    ) -> np.ndarray:
        """
        Encode with one model and optional prefix (e.g. from job config).
        Used when frontend sends encoderModel + encoderPrefix.
        """
        enc = self._ensure_model_loaded(model_name)
        if prefix:
            sep = " " if not prefix.endswith(" ") else ""
            texts = [prefix + sep + t for t in texts]
        enc_with_prefix = {**enc, "prefix": prefix}
        bs = batch_size or self.batch_size
        return self._encode_single(
            enc_with_prefix,
            texts,
            bs,
            normalize,
            progress_callback,
            total_models=1,
            model_index=0,
        )

    def get_display_name(self, model_name: str | None = None, prefix: str | None = None) -> str:
        """Display string for meta (e.g. 'model/name' or 'model/name (prefix: "query: ")' )."""
        name = model_name or self.model_name
        if prefix:
            return f'{name} (prefix: "{prefix}")'
        return name

    def health_check(self) -> dict:
        """Sprawdza status serwisu."""
        if not self._loaded:
            return {
                "status": "not_loaded",
                "model": self.model_name,
            }
        start = time.time()
        try:
            self.encode(["test"], batch_size=1)
            latency = int((time.time() - start) * 1000)
            return {
                "status": "up",
                "model": self.model_name,
                "device": str(self._loaded_models[0]["device"]) if self._loaded_models else "n/a",
                "latencyMs": latency,
            }
        except Exception as e:
            return {
                "status": "error",
                "model": self.model_name,
                "error": str(e),
            }
