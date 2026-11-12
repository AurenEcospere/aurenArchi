# Auren Arch

A local, single-floor architectural workspace for Auren Ecosphere. Upload a measured plan, review an AI draft, edit dimensioned geometry in synchronized 2D/3D, and export reusable project files. The application also works manually without AI credentials.

## Run

Requires Node.js 22.12+ (Node 24 LTS recommended) and npm.

    npm install
    npm run dev

Open http://127.0.0.1:5173. The Express backend listens on 127.0.0.1:3001. For a production build on your local machine, run npm run build followed by npm start, then open http://127.0.0.1:3001.

## Credentials: final checkpoint

A gitignored root .env file has been created with an empty OPENAI_API_KEY. Add your key there when ready, then restart npm run dev. Never put the key in frontend variables or commit it. On a fresh clone, copy .env.example to .env first.

| Setting | Default | Purpose |
| --- | --- | --- |
| OPENAI_API_KEY | empty | Server-only API credential |
| OPENAI_DECISION_MODEL | gpt-6-luna | Decisions API drawing classification |
| OPENAI_VISION_MODEL | gpt-6.1-terra | Responses API plan extraction |
| OPENAI_EDIT_MODEL | gpt-6.1-sol | Responses API structured edit proposals |
| OPENAI_IMAGE_MODEL | gpt-image-2.5-sunburst | Image API concept generation/editing |
| AI_MODE | live | Normal app uses real services; no simulated fallback |
| PORT | 3001 | Backend port; update Vite proxy if changing it |

The badge says configured when a key exists; actual access is verified by live tests. Decisions currently supports gpt-6-luna. Model IDs are configurable; your account must have access to them. Image generation may require OpenAI organization verification. See official [Decisions](https://developers.openai.com/api/docs/guides/decisions), [models](https://developers.openai.com/api/docs/models), and [Image API](https://developers.openai.com/api/docs/guides/image-generation) documentation.

## Workflow

1. Explore the bundled sample or upload PNG/JPEG/PDF (maximum 20 MB). Select one PDF page. Images are normalized to a maximum 2000-pixel side for review and AI input.
2. Click two points on a known dimension, enter their distance in millimetres, and confirm scale. AI cannot establish trustworthy physical scale from an unmeasured image.
3. Generate a draft or trace manually. Review walls and openings over the source drawing; correct dimensions in the inspector. Use the element picker for elements outside the canvas. Accept the draft only after resolving geometry issues.
4. Select an element in either view. Use numeric edits, placement tools, or a natural-language command. AI proposals preview both views and require confirmation. X increases right; Y increases downward on the floor plan.
5. Save locally; reload saved projects by name. JSON includes the model, drawing and calibration. SVG has physical millimetre units. GLB uses metres and contains actual wall-opening holes. Concept illustrations remain separate from geometry.

Projects are stored in this browser's IndexedDB; export JSON for backup and transfer. Uploading or selecting a different PDF page starts a new empty model. Undo restores previous accepted project states. Source recalibration rescales plan dimensions, not building heights. Room labels are annotations, not area boundaries.

## Validation

    npm run fixtures
    npm test
    npx playwright install chromium
    npm run test:ui
    npm run build
    npm run report

Open reports/index.html for a filterable test report with screenshots. Generated fixtures and reports are ignored by Git. Browser tests use explicitly intercepted simulated AI responses; normal app behavior never substitutes them. Tests include 18 clean uploads across six layout families and three formats, six degraded drawings, a multi-page PDF, 30 seeded geometry layouts, saving/reloading, editing, undo/redo, malformed inputs, missing credentials, SVG scale, GLB reload and hole raycasting, and image workflow isolation.

After adding credentials and restarting the development server:

    npm run test:live
    npm run report

Live tests incur API usage. They test the 24-case extraction dataset, six Sol comparisons, numeric editing, ambiguity, rejected conflicts, Decisions classification, image generation/editing, and a live browser workflow. Reports preserve raw extraction metrics separately from a reference-corrected workflow. Live recognition results must be inspected; successful API transport alone does not establish accurate geometry. No live OpenAI tests have been run before credentials are supplied.

## Architecture and limitations

shared/ owns the versioned millimetre model, validation, edit operations, and geometry. src/ owns the React workspace, SVG editor, Three.js scene, file handling and IndexedDB persistence. server/ owns credentials and OpenAI requests. Tests inject services at the backend boundary or intercept requests in the browser.

Checks cover positive dimensions, unique IDs, opening hosts/bounds/overlap, furniture-wall/object collisions, a 600 mm door review zone, and stale revisions. They do not establish connected rooms, code compliance, structural safety, or comprehensive clearance requirements. Walls are straight segments, furniture is axis aligned, and AI output requires review. Multi-floor BIM, DXF/IFC/STEP, BOQ, walkthroughs, collaboration, accounts and public hosting are deferred. The backend binds to loopback and is intended for a trusted local workstation.
