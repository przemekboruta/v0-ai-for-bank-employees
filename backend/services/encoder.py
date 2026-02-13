"""
Encoder Service - ModernBERT-base
Laduje model answerdotai/ModernBERT-base i generuje embeddingi dla tekstow.
Singleton pattern - model jest ladowany raz przy starcie.
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

import numpy as np
import torch
from transformers import AutoTokenizer, AutoModel

if TYPE_CHECKING:
    pass

from config import (
    ENCODER_MODEL_NAME,
    ENCODER_BATCH_SIZE,
    ENCODER_MAX_SEQ_LENGTH,
    ENCODER_DEVICE,
)

logger = logging.getLogger(__name__)


class EncoderService:
    """
    Serwis enkodowania tekstow za pomoca ModernBERT.
    Uzywa mean pooling na ostatniej warstwie ukrytej.
    """

    _instance: EncoderService | None = None

    def __init__(self) -> None:
        self.model_name = ENCODER_MODEL_NAME
        self.batch_size = ENCODER_BATCH_SIZE
        self.max_seq_length = ENCODER_MAX_SEQ_LENGTH
        self.model = None
        self.tokenizer = None
        self.device = None
        self._loaded = False

    @classmethod
    def get_instance(cls) -> EncoderService:
        if cls._instance is None:
            cls._instance = EncoderService()
        return cls._instance

    def load(self) -> None:
        """Laduje model i tokenizer. Wywolywane raz przy starcie serwera."""
        if self._loaded:
            return

        logger.info(f"Ladowanie modelu encoder: {self.model_name}")
        start = time.time()

        # Okresl urzadzenie
        if ENCODER_DEVICE == "auto":
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        else:
            self.device = torch.device(ENCODER_DEVICE)

        logger.info(f"Urzadzenie: {self.device}")

        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        self.model = AutoModel.from_pretrained(self.model_name)
        self.model.to(self.device)
        self.model.eval()

        elapsed = time.time() - start
        logger.info(f"Model zaladowany w {elapsed:.1f}s")
        self._loaded = True

    def _mean_pooling(
        self,
        model_output: torch.Tensor,
        attention_mask: torch.Tensor,
    ) -> torch.Tensor:
        """Mean pooling - uwzglednia attention mask."""
        token_embeddings = model_output.last_hidden_state
        input_mask_expanded = (
            attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
        )
        return torch.sum(token_embeddings * input_mask_expanded, 1) / torch.clamp(
            input_mask_expanded.sum(1), min=1e-9
        )

    @torch.no_grad()
    def encode(
        self,
        texts: list[str],
        batch_size: int | None = None,
        normalize: bool = True,
        progress_callback: callable | None = None,
    ) -> np.ndarray:
        """
        Generuje embeddingi dla listy tekstow.

        Args:
            texts: Lista tekstow do enkodowania
            batch_size: Rozmiar batcha (domyslnie z konfiguracji)
            normalize: Czy L2 normalizowac wektory
            progress_callback: Opcjonalna funkcja callback(batch_num, total_batches, processed, total)

        Returns:
            np.ndarray o ksztalcie (len(texts), embedding_dim)
        """
        if not self._loaded:
            self.load()

        bs = batch_size or self.batch_size
        all_embeddings: list[np.ndarray] = []
        total_batches = (len(texts) + bs - 1) // bs

        for i in range(0, len(texts), bs):
            batch_texts = texts[i : i + bs]
            batch_num = i // bs + 1

            encoded = self.tokenizer(
                batch_texts,
                padding=True,
                truncation=True,
                max_length=self.max_seq_length,
                return_tensors="pt",
            )
            encoded = {k: v.to(self.device) for k, v in encoded.items()}

            output = self.model(**encoded)
            embeddings = self._mean_pooling(output, encoded["attention_mask"])

            if normalize:
                embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)

            all_embeddings.append(embeddings.cpu().numpy())

            # Call progress callback if provided
            if progress_callback:
                try:
                    progress_callback(batch_num, total_batches, min(i + bs, len(texts)), len(texts))
                except Exception as e:
                    logger.warning(f"Progress callback error: {e}")

            logger.debug(
                f"Batch {batch_num}/{total_batches}: "
                f"{len(batch_texts)} tekstow"
            )

        result = np.vstack(all_embeddings)
        logger.info(
            f"Zakodowano {len(texts)} tekstow -> shape {result.shape}"
        )
        return result

    def health_check(self) -> dict:
        """Sprawdza status serwisu."""
        if not self._loaded:
            return {
                "status": "not_loaded",
                "model": self.model_name,
            }

        # Szybki test enkodowania
        start = time.time()
        try:
            self.encode(["test"], batch_size=1)
            latency = int((time.time() - start) * 1000)
            return {
                "status": "up",
                "model": self.model_name,
                "device": str(self.device),
                "latencyMs": latency,
            }
        except Exception as e:
            return {
                "status": "error",
                "model": self.model_name,
                "error": str(e),
            }
