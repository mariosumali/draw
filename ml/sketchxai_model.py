"""Minimal SketchXAI model adapter for local evaluation.

Adapted from https://github.com/WinKawaks/SketchXAI (Apache-2.0).
The upstream Hugging Face repos declare `ViTForSketchClassification`, but do not
ship the custom modeling code or image processor. This module keeps the model
definition local and adjusts device handling for CPU/MPS/current Transformers.
"""

from __future__ import annotations

import numpy as np
import torch
from torch import nn
from transformers import ViTForImageClassification, ViTModel
from transformers.modeling_outputs import BaseModelOutputWithPooling
from transformers.models.vit.modeling_vit import ViTEmbeddings


class StrokeEmbeddings(ViTEmbeddings):
    """Build CLS, stroke-shape, stroke-order, and stroke-location embeddings."""

    def __init__(self, config, opt: dict[str, object], use_mask_token: bool = True):
        super().__init__(config, use_mask_token)
        self.cls_token = nn.Parameter(torch.zeros(1, 1, config.hidden_size))
        lstm_hidden_size = int(config.hidden_size / 2)
        shape_extractor = str(opt["shape_extractor"])
        shape_extractor_layers = int(opt["shape_extractor_layer"])
        if shape_extractor == "lstm":
            self.stroke_embeddings = nn.LSTM(
                4,
                lstm_hidden_size,
                num_layers=shape_extractor_layers,
                batch_first=True,
                bidirectional=True,
            )
        elif shape_extractor == "gru":
            self.stroke_embeddings = nn.GRU(
                4,
                lstm_hidden_size,
                num_layers=shape_extractor_layers,
                batch_first=True,
                bidirectional=True,
            )
        else:
            raise ValueError(f"Unsupported shape extractor: {shape_extractor}")

        self.num_patches = int(opt["max_stroke"])
        self.batch_size = int(opt["bs"])
        self.order_embeddings = nn.Embedding(self.num_patches, config.hidden_size)
        self.location_embeddings = nn.Linear(2, config.hidden_size)
        self.shape_func = str(opt["shape_emb"])
        self.mask_tokens = None
        if use_mask_token:
            mask_token = torch.zeros(1, 1, config.hidden_size)
            self.mask_tokens = mask_token.expand(self.batch_size, self.num_patches + 1, -1)

    def reconstruct_batch(
        self,
        embeddings: torch.Tensor,
        position_values: torch.Tensor,
        stroke_number: list[np.ndarray],
    ) -> tuple[torch.Tensor, torch.Tensor]:
        device = embeddings.device
        batch_embeddings = torch.zeros(
            self.batch_size,
            self.num_patches,
            self.config.hidden_size,
            device=device,
        )
        batch_positions = torch.zeros(self.batch_size, self.num_patches, 2, device=device)
        strokes = np.asarray([stroke.size for stroke in stroke_number])

        for sketch_index, sketch_strokes in enumerate(strokes):
            start = int(np.sum(strokes[:sketch_index]))
            end = start + int(sketch_strokes)
            batch_embeddings[sketch_index, :sketch_strokes, :] = embeddings[start:end, :]
            batch_positions[sketch_index, :sketch_strokes, :] = position_values[start:end, :]
        return batch_embeddings, batch_positions

    def lstm_out(self, embed: torch.Tensor, text_length: list[np.ndarray]) -> torch.Tensor:
        stroke_lengths = np.hstack(text_length)
        length_tensor = torch.from_numpy(stroke_lengths).to(embed.device)
        _, idx_sort = torch.sort(length_tensor, dim=0, descending=True)
        _, idx_unsort = torch.sort(idx_sort, dim=0)

        embed_sort = embed.index_select(0, idx_sort).float()
        length_list = length_tensor[idx_sort]
        packed = nn.utils.rnn.pack_padded_sequence(embed_sort, length_list.cpu(), batch_first=True)
        sorted_out, _ = self.stroke_embeddings(packed)
        sorted_out = nn.utils.rnn.pad_packed_sequence(sorted_out, batch_first=True)[0]
        output = sorted_out.index_select(0, idx_unsort)

        if self.shape_func == "sum":
            return torch.sum(output, dim=1)
        if self.shape_func == "mean":
            return torch.mean(output, dim=1)
        raise ValueError(f"Unsupported shape embedding reducer: {self.shape_func}")

    def forward(
        self,
        points_values: torch.Tensor,
        position_values: torch.Tensor,
        stroke_number: list[np.ndarray],
        bool_masked_pos: torch.Tensor | None = None,
    ) -> torch.Tensor:
        device = points_values.device
        shape_emb = self.lstm_out(points_values, stroke_number)
        shape_emb, new_position_values = self.reconstruct_batch(shape_emb, position_values, stroke_number)

        order = torch.arange(0, self.num_patches, device=device)
        order_emb = self.order_embeddings(order).unsqueeze(0)
        location_emb = self.location_embeddings(new_position_values)
        embeddings = shape_emb + order_emb + location_emb

        cls_tokens = self.cls_token.expand(self.batch_size, -1, -1).to(device)
        embeddings = torch.cat((cls_tokens, embeddings), dim=1)

        if bool_masked_pos is not None:
            if self.mask_tokens is None:
                raise ValueError("Mask token requested but model was created without mask tokens.")
            mask = bool_masked_pos.unsqueeze(-1).type_as(embeddings).to(device)
            embeddings = embeddings * (1.0 - mask) + self.mask_tokens.to(device) * mask

        return self.dropout(embeddings)


class SketchViT(ViTModel):
    def __init__(
        self,
        config,
        opt: dict[str, object],
        labels_number: int = 345,
        add_pooling_layer: bool = True,
        use_mask_token: bool = True,
    ):
        super().__init__(config, add_pooling_layer)
        self.embeddings = StrokeEmbeddings(config, opt, use_mask_token=use_mask_token)
        self.fc = nn.Linear(config.hidden_size, labels_number)

    def forward(
        self,
        point_values: torch.Tensor | None = None,
        position_values: torch.Tensor | None = None,
        stroke_number: list[np.ndarray] | None = None,
        bool_masked_pos: torch.Tensor | None = None,
        **_: object,
    ):
        if point_values is None or position_values is None or stroke_number is None:
            raise ValueError("point_values, position_values, and stroke_number are required.")

        embedding_output = self.embeddings(
            point_values,
            position_values,
            stroke_number,
            bool_masked_pos=bool_masked_pos,
        )
        encoder_outputs = self.encoder(embedding_output)
        sequence_output = encoder_outputs[0]
        sequence_output = self.layernorm(sequence_output)
        pooled_output = self.pooler(sequence_output) if self.pooler is not None else None
        logits = self.fc(sequence_output[:, 0, :])

        return logits, BaseModelOutputWithPooling(
            last_hidden_state=sequence_output,
            pooler_output=pooled_output,
            hidden_states=getattr(encoder_outputs, "hidden_states", None),
            attentions=getattr(encoder_outputs, "attentions", None),
        )


class ViTForSketchClassification(ViTForImageClassification):
    def __init__(
        self,
        config,
        opt: dict[str, object],
        labels_number: int = 345,
        use_mask_token: bool = True,
    ):
        super().__init__(config)
        self.vit = SketchViT(
            config,
            opt,
            labels_number,
            add_pooling_layer=False,
            use_mask_token=use_mask_token,
        )

    def forward(
        self,
        point_values: torch.Tensor | None = None,
        position_values: torch.Tensor | None = None,
        stroke_number: list[np.ndarray] | None = None,
        bool_masked_pos: torch.Tensor | None = None,
        **kwargs: object,
    ):
        logits, outputs = self.vit(
            point_values,
            position_values,
            stroke_number,
            bool_masked_pos=bool_masked_pos,
            **kwargs,
        )
        return logits, outputs.last_hidden_state, outputs.attentions
