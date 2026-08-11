def filter(snapshot: dict) -> bool:
    return float(snapshot.get("Total unsigned flux", 0)) > 0
