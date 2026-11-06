# Project guidance

- Make the smallest coherent change; avoid unrelated cleanup and formatting churn.
- Search for existing code and patterns before adding new implementations.
- Preserve public behavior and keep changes local to the owning module.
- Do not change generated files, lockfiles, dependencies, or configuration unless required.
- This repository currently contains documentation only; no application architecture, setup commands, tests, or deployment workflow are defined yet.
- Validate documentation changes by reviewing the diff. Add relevant setup and validation instructions when application code is introduced.
- Do not commit secrets or credentials. Push changes only when authorized.
