from collections import deque


START_ZONE = "START_ZONE"
EXPAND = "EXPAND"
STOP_ZONE = "STOP_ZONE"


def choose_zone_root(
    zone_nodes,
    neighbor_lists,
):
    """
    Pick a central-ish node.

    Initial implementation:
    node with minimum average graph distance
    to the other nodes in the same zone.
    """

    if len(zone_nodes) == 1:
        return zone_nodes[0]

    zone_set = set(zone_nodes)

    best_node = None
    best_score = float("inf")

    for candidate in zone_nodes:

        queue = deque([candidate])
        distances = {
            candidate: 0
        }

        while queue:

            current = queue.popleft()

            for neighbor in neighbor_lists[current]:

                if neighbor not in zone_set:
                    continue

                if neighbor in distances:
                    continue

                distances[neighbor] = (
                    distances[current] + 1
                )

                queue.append(neighbor)

        score = sum(
            distances.get(
                node,
                len(zone_nodes),
            )
            for node in zone_nodes
        )

        if score < best_score:
            best_score = score
            best_node = candidate

    return best_node


def build_zone_sequence(
    zone_nodes,
    zone_id,
    neighbor_lists,
):
    zone_set = set(zone_nodes)

    root = choose_zone_root(
        zone_nodes,
        neighbor_lists,
    )

    sequence = [
        {
            "action": START_ZONE,
            "root": root,
            "zone": zone_id,
        }
    ]

    visited = {root}

    queue = deque([root])

    while queue:

        current = queue.popleft()

        neighbors = [
            n
            for n in neighbor_lists[current]
            if n in zone_set
            and n not in visited
        ]

        # Deterministic ordering.
        neighbors.sort()

        for neighbor in neighbors:

            visited.add(neighbor)

            sequence.append(
                {
                    "action": EXPAND,
                    "cell": neighbor,
                    "zone": zone_id,
                }
            )

            queue.append(neighbor)

    sequence.append(
        {
            "action": STOP_ZONE,
            "zone": zone_id,
        }
    )

    return sequence


def build_city_sequence(
    zone_assignments,
    neighbor_lists,
    num_zones,
):
    """
    zone_assignments[node] = zone ID
    """

    sequences = []

    for zone_id in range(num_zones):

        zone_nodes = [
            i
            for i, assigned_zone
            in enumerate(zone_assignments)
            if assigned_zone == zone_id
        ]

        if not zone_nodes:
            continue

        zone_sequence = build_zone_sequence(
            zone_nodes,
            zone_id,
            neighbor_lists,
        )

        sequences.extend(
            zone_sequence
        )

    return sequences
