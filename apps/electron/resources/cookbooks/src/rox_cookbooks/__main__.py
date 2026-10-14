"""`python -m rox_cookbooks` → the same CLI as the `rox-cookbooks` script."""
import sys

from .ui import main

if __name__ == "__main__":
    sys.exit(main())
