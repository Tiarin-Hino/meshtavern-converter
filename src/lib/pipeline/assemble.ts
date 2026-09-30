/**
 * A figure shipped in several files, put together before anything else (issue #93, design note
 * docs/design/marks-where-parts-meet.md §4.2): every part where its file puts it, or where a
 * pair of marks puts it against a part already placed. The union is one mesh in the body's file
 * frame, the body first, then the other parts in file order; the parts stay separate surfaces,
 * as a figure and its base do after #70.
 */
import type { Vec3 } from './base';
import { meetingRotation, resolveMark, type Mark, type PartJoint } from './marks';
import type { IndexedMesh } from './mesh';
import { ConversionProblem } from './problems';
import { apply, IDENTITY, toMatrix, type Rotation } from './rotation';

/** At most this many files make one mini: a figure's parts and its base. _(proposal, the issue's number)_ */
export const MAX_PARTS = 6;

/** How a figure's parts are put together. */
export interface PartsOptions {
  /** One joint per part that is not where its file puts it; a part without one stays where its file puts it. */
  joints: PartJoint[];
}

/** One part of a figure as it was put together. */
export interface PartResult {
  file: number;
  /** `files`: where its file puts it. `marked`: a joint. `body`: the body itself. */
  source: 'body' | 'files' | 'marked';
  /** The part's file coordinates to the body's file frame. Identity for `body` and `files`. */
  rotation: Rotation;
  translation: Vec3;
  /** Its joint as resolved, in the body's frame: the spot on `onto`, the contact where it ended. Only for `marked`. */
  joint?: { onto: number; spot: Mark; contact: Mark; liftMm: number; turnDeg: number };
  /** Its triangles in the merged mesh: the figure lists the body first, then the parts in file order, then the base. */
  triangles: number;
}

/** A transform: file coordinates to the body's file frame, `rotation · p + translation`. */
interface Transform {
  rotation: Rotation;
  translation: Vec3;
}

const HOLD: Transform = { rotation: IDENTITY, translation: [0, 0, 0] };

const placePoint = ({ rotation, translation }: Transform, p: Vec3): Vec3 => {
  const turned = apply(rotation, p);
  return [turned[0] + translation[0], turned[1] + translation[1], turned[2] + translation[2]];
};

/**
 * The transform a joint gives its part (design note §4.2): the spot resolved on `onto`'s file
 * and carried into the body's frame by `onto`'s transform, the contact resolved on the part's
 * file; the contact's normal turned against the spot's, `turnDeg` about it, the contact point on
 * the spot point raised by `liftMm` along the spot's normal.
 */
export function jointTransform(
  part: IndexedMesh,
  onto: IndexedMesh,
  ontoTransform: Transform,
  joint: PartJoint,
): { transform: Transform; spot: Mark; contact: Mark } {
  const spotOnFile = resolveMark(onto, joint.spot.point);
  const contactOnFile = resolveMark(part, joint.contact.point);
  if (!spotOnFile || !contactOnFile)
    throw new ConversionProblem('unexpected', `a joint of file ${joint.part} on an empty file`);
  const point = placePoint(ontoTransform, spotOnFile.point);
  const normal = apply(ontoTransform.rotation, spotOnFile.normal);
  const liftMm = joint.liftMm ?? 0;
  const rotation = meetingRotation(contactOnFile.normal, normal, joint.turnDeg ?? 0);
  const target: Vec3 = [
    point[0] + liftMm * normal[0],
    point[1] + liftMm * normal[1],
    point[2] + liftMm * normal[2],
  ];
  const turned = apply(rotation, contactOnFile.point);
  return {
    transform: {
      rotation,
      translation: [target[0] - turned[0], target[1] - turned[1], target[2] - turned[2]],
    },
    spot: { point, normal },
    contact: { point: target, normal: [0 - normal[0], 0 - normal[1], 0 - normal[2]] },
  };
}

/** A part's positions carried into the body's frame. */
function transformed(positions: Float32Array, { rotation, translation }: Transform): Float32Array {
  const m = toMatrix(rotation);
  const [tx, ty, tz] = translation;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    out[i] = m[0]! * x + m[1]! * y + m[2]! * z + tx;
    out[i + 1] = m[3]! * x + m[4]! * y + m[5]! * z + ty;
    out[i + 2] = m[6]! * x + m[7]! * y + m[8]! * z + tz;
  }
  return out;
}

/**
 * The figure put together from its parts (design note §4.2). The body (`figureFiles[0]`) stays
 * in its file frame; a part without a joint keeps its file coordinates, bit for bit; a part with
 * one goes where the joint puts it against its `onto`, which is resolved first whatever the
 * order of the joints (a cycle, or a joint naming a file that is not a figure part, is a bug of
 * the caller: `unexpected`). The union lists the body, then the other parts in file order.
 *
 * @param meshes Every file's welded mesh, by file index; the base's, if any, is not read.
 * @param figureFiles The figure's parts by file index, the body first.
 */
export function assembleFigure(
  meshes: readonly IndexedMesh[],
  figureFiles: readonly number[],
  joints: readonly PartJoint[],
): { mesh: IndexedMesh; parts: PartResult[] } {
  const body = figureFiles[0]!;
  const isPart = (file: number): boolean => figureFiles.includes(file) && file !== body;
  const byPart = new Map<number, PartJoint>();
  for (const joint of joints) {
    if (
      !isPart(joint.part) ||
      !figureFiles.includes(joint.onto) ||
      joint.onto === joint.part ||
      joint.spot.file !== joint.onto ||
      joint.contact.file !== joint.part
    )
      throw new ConversionProblem(
        'unexpected',
        `a joint of file ${joint.part} onto ${joint.onto} with marks on ${joint.spot.file} and ${joint.contact.file}`,
      );
    byPart.set(joint.part, joint);
  }

  const transforms = new Map<number, Transform>([[body, HOLD]]);
  const resolved = new Map<number, PartResult['joint']>();
  const resolving = new Set<number>();
  const transformOf = (file: number): Transform => {
    const known = transforms.get(file);
    if (known) return known;
    const joint = byPart.get(file);
    if (!joint) {
      transforms.set(file, HOLD);
      return HOLD;
    }
    if (resolving.has(file))
      throw new ConversionProblem('unexpected', `the joints of files ${[...resolving]} go round`);
    resolving.add(file);
    const onto = transformOf(joint.onto);
    const { transform, spot, contact } = jointTransform(
      meshes[file]!,
      meshes[joint.onto]!,
      onto,
      joint,
    );
    resolving.delete(file);
    transforms.set(file, transform);
    resolved.set(file, {
      onto: joint.onto,
      spot,
      contact,
      liftMm: joint.liftMm ?? 0,
      turnDeg: joint.turnDeg ?? 0,
    });
    return transform;
  };

  let vertexCount = 0;
  let indexCount = 0;
  for (const file of figureFiles) {
    vertexCount += meshes[file]!.positions.length;
    indexCount += meshes[file]!.indices.length;
  }
  const positions = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);
  const parts: PartResult[] = [];
  let at = 0;
  let atIndex = 0;
  for (const file of figureFiles) {
    const mesh = meshes[file]!;
    const transform = transformOf(file);
    const joint = resolved.get(file);
    positions.set(joint ? transformed(mesh.positions, transform) : mesh.positions, at);
    const offset = at / 3;
    for (let i = 0; i < mesh.indices.length; i++) indices[atIndex + i] = mesh.indices[i]! + offset;
    at += mesh.positions.length;
    atIndex += mesh.indices.length;
    parts.push({
      file,
      source: file === body ? 'body' : joint ? 'marked' : 'files',
      rotation: transform.rotation,
      translation: transform.translation,
      ...(joint && { joint }),
      triangles: mesh.indices.length / 3,
    });
  }
  return { mesh: { positions, indices }, parts };
}

/** A figure of one file: its body, where its file puts it. */
export const wholePart = (file: number, mesh: IndexedMesh): PartResult => ({
  file,
  source: 'body',
  rotation: IDENTITY,
  translation: [0, 0, 0],
  triangles: mesh.indices.length / 3,
});

/** A mark resolved on a part's file, carried into the body's frame by the part's transform. */
export const partMark = (part: Pick<PartResult, 'rotation' | 'translation'>, mark: Mark): Mark => ({
  point: placePoint(part, mark.point),
  normal: apply(part.rotation, mark.normal),
});
