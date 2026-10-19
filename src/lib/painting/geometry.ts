import * as THREE from 'three';
import { MAX_GROUPS } from '../pipeline/brush';
import type { IndexedMesh } from '../pipeline/mesh';

/**
 * The painting view's own geometry (issue #139, design note `docs/design/paint-groups.md` §5.1):
 * the table level de-indexed, three vertices a triangle, with a `group` attribute, a byte a vertex,
 * from the group map. Triangle t is vertices 3t, 3t + 1 and 3t + 2, so a group's edges are the
 * geometry's edges and a group edit moves no vertex: it writes three bytes a triangle. The search
 * tree, the adjacency, the regions and the fill's cut stay over the table level, whose triangle
 * numbering this keeps.
 */

/** The geometry's attributes: what the passes share with the display. */
export const GROUPED_ATTRIBUTES = ['position', 'normal', 'uv', 'occlusion', 'group'] as const;

/** The table level de-indexed, with each corner's group from `groups` (a byte a triangle). */
export function createGroupedGeometry(mesh: IndexedMesh, groups: Uint8Array): THREE.BufferGeometry {
  const { positions, indices } = mesh;
  const normals = mesh.normals!;
  const uvs = mesh.uvs!;
  const occlusion = mesh.occlusion ?? null;
  const triangles = indices.length / 3;
  if (groups.length !== triangles)
    throw new RangeError('The groups are not this mesh’s: one byte per triangle');
  const corners = triangles * 3;
  const outPositions = new Float32Array(corners * 3);
  const outNormals = new Float32Array(corners * 3);
  const outUvs = new Float32Array(corners * 2);
  const outOcclusion = new Float32Array(corners);
  for (let corner = 0; corner < corners; corner++) {
    const v = indices[corner]!;
    for (let axis = 0; axis < 3; axis++) {
      outPositions[corner * 3 + axis] = positions[v * 3 + axis]!;
      outNormals[corner * 3 + axis] = normals[v * 3 + axis]!;
    }
    outUvs[corner * 2] = uvs[v * 2]!;
    outUvs[corner * 2 + 1] = uvs[v * 2 + 1]!;
    outOcclusion[corner] = occlusion ? occlusion[v]! : 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(outPositions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(outNormals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(outUvs, 2));
  geometry.setAttribute('occlusion', new THREE.BufferAttribute(outOcclusion, 1));
  const group = new THREE.BufferAttribute(new Uint8Array(corners), 1);
  geometry.setAttribute('group', group);
  writeGroups(geometry, groups);
  return geometry;
}

/** The group map into the geometry's `group` attribute: three bytes a triangle, uploaded at the next draw. */
export function writeGroups(geometry: THREE.BufferGeometry, groups: Uint8Array): void {
  const attribute = geometry.getAttribute('group') as THREE.BufferAttribute;
  const bytes = attribute.array as Uint8Array;
  for (let t = 0; t < groups.length; t++) {
    const group = groups[t]!;
    bytes[t * 3] = group;
    bytes[t * 3 + 1] = group;
    bytes[t * 3 + 2] = group;
  }
  attribute.needsUpdate = true;
}

/** The corners in order, 0 … 3T − 1: the de-indexed geometry's own index, for its edges and regions. */
export function cornersOf(triangles: number): Uint32Array {
  const corners = new Uint32Array(triangles * 3);
  for (let k = 0; k < corners.length; k++) corners[k] = k;
  return corners;
}

/** `uGroups`: a vec4 a group, its offset in mm in xyz, 1 in w where hidden; all at zero, shown. */
export function createGroupUniform(): { value: THREE.Vector4[] } {
  return { value: Array.from({ length: MAX_GROUPS }, () => new THREE.Vector4(0, 0, 0, 0)) };
}

/**
 * The GLSL every vertex shader of the engine adds (§5.2): the group's vec4 of `uGroups`, by the
 * `group` attribute. `MT_GROUP_HIDDEN` is a clip position outside the view: a hidden triangle's
 * three vertices there have no area and no fragment, on screen and in every texture-space pass.
 */
export const GROUP_VERTEX_GLSL = /* glsl */ `
uniform vec4 uGroups[ ${MAX_GROUPS} ];
#define MT_GROUP_HIDDEN vec4( 2.0, 2.0, 2.0, 1.0 )
`;
