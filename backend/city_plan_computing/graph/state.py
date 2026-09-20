import torch

from .features import build_dynamic_features


class CityState:

    def __init__(
        self,
        num_nodes,
        neighbor_lists,
        num_zones,
    ):
        self.num_nodes = num_nodes

        self.neighbor_lists = neighbor_lists

        self.num_zones = num_zones

        # -1 = unassigned
        # 0+ = zone ID
        self.assigned_zones = torch.full(
            (num_nodes,),
            -1,
            dtype=torch.long,
        )

    def assign(self, node_index, zone_id):

        if self.assigned_zones[node_index] != -1:
            raise ValueError(
                f"Node {node_index} already assigned"
            )

        self.assigned_zones[
            node_index
        ] = zone_id

    def is_assigned(self, node_index):
        return (
            self.assigned_zones[node_index]
            != -1
        )

    def unassigned_nodes(self):
        return torch.where(
            self.assigned_zones == -1
        )[0]

    def frontier(self, zone_id):
        """
        Return unassigned nodes adjacent to
        at least one node belonging to zone_id.
        """

        frontier = set()

        for node in range(self.num_nodes):

            if self.assigned_zones[node] != zone_id:
                continue

            for neighbor in self.neighbor_lists[node]:

                if (
                    self.assigned_zones[neighbor]
                    == -1
                ):
                    frontier.add(neighbor)

        return list(frontier)

    def build_features(self, static_features):
        dynamic = build_dynamic_features(
            self.assigned_zones.numpy(),
            self.neighbor_lists,
            self.num_zones,
        )

        dynamic = torch.tensor(
            dynamic,
            dtype=torch.float32,
        )

        return torch.cat(
            [
                static_features,
                dynamic,
            ],
            dim=1,
        )
