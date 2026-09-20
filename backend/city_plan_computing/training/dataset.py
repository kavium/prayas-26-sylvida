import copy

import torch


class TrainingState:

    def __init__(
        self,
        assigned_zones,
        active_zone=None,
        root_target=None,
        expand_target=None,
        zone_target=None,
        stop_target=None,
    ):
        self.assigned_zones = assigned_zones.clone()

        self.active_zone = active_zone

        self.root_target = root_target

        self.expand_target = expand_target

        self.zone_target = zone_target

        self.stop_target = stop_target

def create_training_states(
    sequence,
    num_nodes,
):
    states = []

    assigned = torch.full(
        (num_nodes,),
        -1,
        dtype=torch.long,
    )

    current_zone = None

    for action in sequence:

        action_type = action["action"]

        if action_type == "START_ZONE":

            current_zone = action["zone"]

            states.append(
                TrainingState(
                    assigned_zones=assigned,
                    active_zone=current_zone,
                    root_target=action["root"],
                    zone_target=current_zone,
                )
            )

            assigned[
                action["root"]
            ] = current_zone

        elif action_type == "EXPAND":

            states.append(
                TrainingState(
                    assigned_zones=assigned,
                    active_zone=current_zone,
                    expand_target=action["cell"],
                )
            )

            assigned[
                action["cell"]
            ] = current_zone

        elif action_type == "STOP_ZONE":

            states.append(
                TrainingState(
                    assigned_zones=assigned,
                    active_zone=current_zone,
                    stop_target=1.0,
                )
            )

            current_zone = None

    return states
