import torch


class CityGeneratorEngine:

    def __init__(
        self,
        model,
        graph,
        static_features,
        num_zones,
        device,
    ):
        self.model = model

        self.graph = graph

        self.static_features = (
            static_features
        )

        self.num_zones = num_zones

        self.device = device

    @torch.no_grad()
    def generate(self):

        self.model.eval()

        num_nodes = self.graph.num_nodes

        assigned = torch.full(
            (num_nodes,),
            -1,
            dtype=torch.long,
        )

        generation_log = []

        while torch.any(assigned == -1):

            # -------------------------
            # BUILD CURRENT STATE
            # -------------------------

            dynamic = (
                self._dynamic_features(
                    assigned
                )
            )

            x = torch.cat(
                [
                    self.static_features,
                    dynamic,
                ],
                dim=1,
            ).to(self.device)

            edge_index = (
                self.graph.edge_index
                .to(self.device)
            )

            outputs = self.model(
                x,
                edge_index,
            )

            h = outputs[
                "embeddings"
            ]

            # -------------------------
            # CHOOSE NEW ROOT
            # -------------------------

            unassigned = torch.where(
                assigned == -1
            )[0]

            root_logits = (
                outputs["root_logits"]
                [unassigned]
            )

            root_position = torch.argmax(
                root_logits
            )

            root = int(
                unassigned[root_position]
            )

            # -------------------------
            # CHOOSE ZONE
            # -------------------------

            zone_logits = (
                outputs["zone_logits"]
                [root]
            )

            zone = int(
                torch.argmax(
                    zone_logits
                )
            )

            assigned[root] = zone

            generation_log.append(
                {
                    "action": "START_ZONE",
                    "cell": root,
                    "zone": zone,
                }
            )

            # -------------------------
            # EXPAND
            # -------------------------

            while True:

                dynamic = (
                    self._dynamic_features(
                        assigned
                    )
                )

                x = torch.cat(
                    [
                        self.static_features,
                        dynamic,
                    ],
                    dim=1,
                ).to(self.device)

                outputs = self.model(
                    x,
                    edge_index,
                )

                h = outputs[
                    "embeddings"
                ]

                frontier = self._frontier(
                    assigned,
                    zone,
                )

                if not frontier:
                    break

                frontier_tensor = torch.tensor(
                    frontier,
                    dtype=torch.long,
                    device=self.device,
                )

                expand_logits = (
                    self.model.expansion_scores(
                        h,
                        frontier_tensor,
                        zone,
                    )
                )

                best_position = torch.argmax(
                    expand_logits
                )

                best_cell = int(
                    frontier_tensor[
                        best_position
                    ]
                )

                assigned[
                    best_cell
                ] = zone

                generation_log.append(
                    {
                        "action": "EXPAND",
                        "cell": best_cell,
                        "zone": zone,
                    }
                )

                # ---------------------
                # STOP DECISION
                # ---------------------

                zone_nodes = torch.where(
                    assigned == zone
                )[0]

                stop_logit = (
                    self.model.stop_score(
                        h,
                        zone_nodes,
                    )
                )

                stop_probability = (
                    torch.sigmoid(
                        stop_logit
                    )
                )

                if (
                    stop_probability.item()
                    > 0.5
                ):
                    break

        return assigned, generation_log

    def _frontier(
        self,
        assigned,
        zone,
    ):
        frontier = set()

        for node in range(
            len(assigned)
        ):

            if assigned[node] != zone:
                continue

            for neighbor in (
                self.graph.neighbor_lists[
                    node
                ]
            ):

                if assigned[neighbor] == -1:
                    frontier.add(neighbor)

        return sorted(frontier)

    def _dynamic_features(
        self,
        assigned,
    ):
        from graph.features import (
            build_dynamic_features,
        )

        dynamic = build_dynamic_features(
            assigned.cpu().numpy(),
            self.graph.neighbor_lists,
            self.num_zones,
        )

        return torch.tensor(
            dynamic,
            dtype=torch.float32,
        )
