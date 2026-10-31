import { useEffect, useState } from "react";
import { loadOrganisation, type OrganisationLoad } from "../../lib/ipc";

/** The organisation's details, asked from the core each time the legal notes open; null while asked. */
export function useOrganisation(): OrganisationLoad | null {
  const [load, setLoad] = useState<OrganisationLoad | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadOrganisation().then((l) => {
      if (!cancelled) setLoad(l);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return load;
}
