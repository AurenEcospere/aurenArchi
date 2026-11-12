# Project guidance

- Make the smallest coherent change; avoid unrelated cleanup and formatting churn.
- Search for existing code and patterns before adding new implementations.
- Preserve public behavior and keep changes local to the owning module.
- Do not change generated files, lockfiles, dependencies, or configuration unless required.
- Architecture: shared/ owns the millimetre model, validated operations and geometry; src/ owns React/SVG/Three.js and local persistence; server/ owns Express and OpenAI calls. Generate both views and exports from the shared model.
- Setup: Node 22.12+; npm install; npm run dev. Local UI is port 5173; backend binds to loopback on port 3001. Production-local setup: npm run build then npm start.
- Validation: npm run fixtures; npm test; npm run test:ui; npm run build; npm run report. Install Chromium with npx playwright install chromium. Keep deterministic geometry assertions independent of fixture generation.
- Tests inject simulated AI explicitly. Never add a silent mock fallback to the application, and never represent simulated tests as evidence of live AI accuracy.
- OpenAI credentials belong only in the gitignored root .env. Wait for the user to provide credentials and confirm readiness before npm run test:live. That suite uses billable APIs; inspect raw recognition results separately from corrected model checks.
- Update README when changing setup, supported geometry, tests or model configuration. Do not expose this local prototype publicly or add deployment infrastructure without authorization.
- Do not commit secrets or credentials. Push changes only when authorized.
