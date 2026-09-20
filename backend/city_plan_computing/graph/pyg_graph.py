import torch
from torch_geometric.data import Data

from .features import (
    extract_static_matrix,
    normalize_matrix,
)


def build_id_mapping(cells):
    return {
        cell["id"]: index
        for index, cell in enumerate(cells)
    }


def build_neighbor_lists(cells, id_to_index):
    neighbor_lists = []

    for cell in cells:

        neighbors = []

        for neighbor_id in cell["neighbors"]:

            if neighbor_id in id_to_index:
                neighbors.append(
                    id_to_index[neighbor_id]
                )

        neighbor_lists.append(neighbors)

    return neighbor_lists


def build_edge_index(neighbor_lists):
    edges = []

    for source, neighbors in enumerate(
        neighbor_lists
    ):
        for target in neighbors:
            edges.append(
                [source, target]
            )

    if not edges:
        return torch.empty(
            (2, 0),
            dtype=torch.long,
        )

    edge_index = torch.tensor(
        edges,
        dtype=torch.long,
    ).t().contiguous()

    return edge_index


def build_targets(cells, zone_to_id):
    targets = []

    for cell in cells:

        zone = cell["type"]

        if zone not in zone_to_id:
            raise ValueError(
                f"Unknown zone type: {zone}"
            )

        targets.append(
            zone_to_id[zone]
        )

    return torch.tensor(
        targets,
        dtype=torch.long,
    )


def build_pyg_graph(
    cells,
    normalization_statistics,
    zone_to_id,
):
    id_to_index = build_id_mapping(cells)

    neighbor_lists = build_neighbor_lists(
        cells,
        id_to_index,
    )

    edge_index = build_edge_index(
        neighbor_lists
    )

    static_features = extract_static_matrix(
        cells
    )

    static_features = normalize_matrix(
        static_features,
        normalization_statistics,
    )

    x = torch.tensor(
        static_features,
        dtype=torch.float32,
    )

    y = build_targets(
        cells,
        zone_to_id,
    )

    data = Data(
        x=x,
        edge_index=edge_index,
        y=y,
    )

    data.cell_ids = [
        cell["id"]
        for cell in cells
    ]

    data.neighbor_lists = neighbor_lists

    return data
