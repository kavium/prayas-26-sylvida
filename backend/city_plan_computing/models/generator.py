import torch
import torch.nn as nn
import torch.nn.functional as F

from torch_geometric.nn import SAGEConv


class CityGenerator(nn.Module):

    def __init__(
        self,
        input_dim,
        hidden_dim,
        num_zones,
        dropout=0.15,
    ):
        super().__init__()

        self.num_zones = num_zones

        # -------------------------
        # GraphSAGE backbone
        # -------------------------

        self.gnn1 = SAGEConv(
            input_dim,
            hidden_dim,
        )

        self.gnn2 = SAGEConv(
            hidden_dim,
            hidden_dim,
        )

        self.gnn3 = SAGEConv(
            hidden_dim,
            hidden_dim,
        )

        self.norm1 = nn.LayerNorm(hidden_dim)
        self.norm2 = nn.LayerNorm(hidden_dim)
        self.norm3 = nn.LayerNorm(hidden_dim)

        self.dropout = nn.Dropout(dropout)

        # -------------------------
        # Zone embeddings
        # -------------------------

        self.zone_embedding = nn.Embedding(
            num_zones,
            hidden_dim,
        )

        # -------------------------
        # Root head
        # -------------------------

        self.root_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 1),
        )

        # -------------------------
        # Expansion head
        #
        # candidate embedding
        # +
        # current zone embedding
        # -------------------------

        self.expand_head = nn.Sequential(
            nn.Linear(
                hidden_dim * 2,
                hidden_dim,
            ),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, 1),
        )

        # -------------------------
        # Zone head
        # -------------------------

        self.zone_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, num_zones),
        )

        # -------------------------
        # STOP head
        #
        # Given current zone's
        # aggregate representation.
        # -------------------------

        self.stop_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 1),
        )

    def encode(
        self,
        x,
        edge_index,
    ):
        h = self.gnn1(
            x,
            edge_index,
        )

        h = self.norm1(h)
        h = F.relu(h)
        h = self.dropout(h)

        h = self.gnn2(
            h,
            edge_index,
        )

        h = self.norm2(h)
        h = F.relu(h)
        h = self.dropout(h)

        h = self.gnn3(
            h,
            edge_index,
        )

        h = self.norm3(h)
        h = F.relu(h)

        return h

    def root_scores(self, h):
        return self.root_head(h).squeeze(-1)

    def zone_scores(self, h):
        return self.zone_head(h)

    def expansion_scores(
        self,
        h,
        candidate_indices,
        zone_id,
    ):
        zone_vector = self.zone_embedding(
            torch.tensor(
                zone_id,
                device=h.device,
            )
        )

        candidate_h = h[candidate_indices]

        zone_vector = zone_vector.expand(
            candidate_h.shape[0],
            -1,
        )

        combined = torch.cat(
            [
                candidate_h,
                zone_vector,
            ],
            dim=-1,
        )

        return self.expand_head(
            combined
        ).squeeze(-1)

    def stop_score(
        self,
        h,
        zone_nodes,
    ):
        zone_h = h[zone_nodes]

        pooled = zone_h.mean(
            dim=0,
            keepdim=True,
        )

        return self.stop_head(
            pooled
        ).squeeze()
    
    def forward(
        self,
        x,
        edge_index,
    ):
        h = self.encode(
            x,
            edge_index,
        )

        return {
            "embeddings": h,
            "root_logits": self.root_scores(h),
            "zone_logits": self.zone_scores(h),
        }
