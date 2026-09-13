# Discovery and evidence reports

`playbooks/discovery.yml` writes `reports/before/<host>.md` on the operator
workstation. Those files, Tailscale ACL dumps, and live fleet matrices stay
local (see `.gitignore`). Do not commit addresses, auth keys, or ACL JSON.
