import { Suspense, Component, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  PerspectiveCamera,
  Environment,
} from "@react-three/drei";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { type Model } from "../shared/model";
import { bounds, wallBoxes, openingPosition } from "../shared/geometry";
import { download } from "./files";
function addBox(
  group: THREE.Group,
  size: number[],
  position: number[],
  color: string,
  angle = 0,
  id = "",
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...(size as [number, number, number])),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );
  mesh.position.set(...(position as [number, number, number]));
  mesh.rotation.y = -angle;
  mesh.name = id;
  group.add(mesh);
}
export function buildScene(model: Model): THREE.Group {
  const group = new THREE.Group(),
    b = bounds(model);
  addBox(
    group,
    [b.width / 1000, 0.12, b.height / 1000],
    [(b.x + b.width / 2) / 1000, -0.06, (b.y + b.height / 2) / 1000],
    "#d8d4c8",
    0,
    "floor",
  );
  for (const wall of model.walls)
    for (const box of wallBoxes(wall, model))
      addBox(
        group,
        [box.width / 1000, box.height / 1000, box.depth / 1000],
        [box.x / 1000, box.z / 1000, box.y / 1000],
        "#eee8dc",
        box.angle,
        wall.id,
      );
  for (const f of model.furniture)
    addBox(
      group,
      [f.width / 1000, f.height / 1000, f.depth / 1000],
      [f.x / 1000, f.height / 2000, f.y / 1000],
      "#b69a78",
      0,
      f.id,
    );
  return group;
}
export async function exportGlb(model: Model) {
  const group = buildScene(model);
  try {
    const data = await new GLTFExporter().parseAsync(group, { binary: true });
    download(data as ArrayBuffer, model.name + ".glb", "model/gltf-binary");
  } finally {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
function Geometry({
  model,
  selected,
  onSelect,
}: {
  model: Model;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const b = bounds(model);
  return (
    <group>
      <mesh
        position={[
          (b.x + b.width / 2) / 1000,
          -0.06,
          (b.y + b.height / 2) / 1000,
        ]}
        receiveShadow
      >
        <boxGeometry args={[b.width / 1000, 0.12, b.height / 1000]} />
        <meshStandardMaterial color="#d8d4c8" />
      </mesh>
      {model.walls.flatMap((w) =>
        wallBoxes(w, model).map((box, i) => (
          <mesh
            key={w.id + "-" + i}
            userData={{ elementId: w.id }}
            position={[box.x / 1000, box.z / 1000, box.y / 1000]}
            rotation={[0, -box.angle, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(w.id);
            }}
            castShadow
            receiveShadow
          >
            <boxGeometry
              args={[box.width / 1000, box.height / 1000, box.depth / 1000]}
            />
            <meshStandardMaterial
              color={selected === w.id ? "#56a48e" : "#eee8dc"}
            />
          </mesh>
        )),
      )}
      {model.openings.map((o) => {
        const w = model.walls.find((w) => w.id === o.wallId);
        if (!w) return null;
        const p = openingPosition(w, o.offset + o.width / 2),
          angle = Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x);
        return (
          <mesh
            key={o.id}
            userData={{ elementId: o.id }}
            position={[
              p.x / 1000,
              (o.sillHeight + o.height / 2) / 1000,
              p.y / 1000,
            ]}
            rotation={[0, -angle, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(o.id);
            }}
          >
            <boxGeometry args={[o.width / 1000, o.height / 1000, 0.025]} />
            <meshStandardMaterial
              color={
                selected === o.id
                  ? "#efb954"
                  : o.kind === "window"
                    ? "#a1d0d4"
                    : "#ba9566"
              }
              transparent
              opacity={o.kind === "window" ? 0.35 : 0.16}
            />
          </mesh>
        );
      })}
      {model.furniture.map((f) => (
        <mesh
          key={f.id}
          userData={{ elementId: f.id }}
          position={[f.x / 1000, f.height / 2000, f.y / 1000]}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(f.id);
          }}
          castShadow
        >
          <boxGeometry
            args={[f.width / 1000, f.height / 1000, f.depth / 1000]}
          />
          <meshStandardMaterial
            color={selected === f.id ? "#56a48e" : "#b69a78"}
          />
        </mesh>
      ))}
    </group>
  );
}
class SceneBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <p className="empty">
        3D graphics are unavailable in this browser. Enable WebGL and reload.
        Your 2D model remains editable.
      </p>
    ) : (
      this.props.children
    );
  }
}
export default function Scene({
  model,
  selected,
  onSelect,
  capture,
}: {
  model: Model;
  selected: string | null;
  onSelect: (id: string) => void;
  capture: React.RefObject<(() => string) | null>;
}) {
  const b = bounds(model),
    cx = (b.x + b.width / 2) / 1000,
    cy = (b.y + b.height / 2) / 1000,
    d = Math.max(b.width, b.height) / 1000;
  return (
    <SceneBoundary>
      <Canvas
        shadows
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        onCreated={({ gl }) => {
          capture.current = () => gl.domElement.toDataURL("image/png");
        }}
      >
        <color attach="background" args={["#e8ece7"]} />
        <ambientLight intensity={1.6} />
        <directionalLight
          position={[cx - 5, 12, cy + 5]}
          intensity={2.5}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <PerspectiveCamera
          makeDefault
          position={[cx + d * 0.9, d * 1.1, cy + d * 0.9]}
          fov={42}
        />
        <OrbitControls
          makeDefault
          target={[cx, 0.7, cy]}
          minDistance={1}
          maxDistance={100}
        />
        <Suspense fallback={null}>
          <Geometry model={model} selected={selected} onSelect={onSelect} />
        </Suspense>
      </Canvas>
    </SceneBoundary>
  );
}
