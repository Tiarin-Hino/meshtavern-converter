import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, LOOK_PRESETS } from '../pipeline/look';
import { createBakedMaterial, createLookUniforms, updateLookUniforms } from './baked-material';

type Compiled = {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
};

/** What three.js hands a material's onBeforeCompile: the standard material's shaders and its own uniforms. */
function compile(material: THREE.Material): Compiled {
  const shader: Compiled = {
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  return shader;
}

const detail = (): THREE.Texture => new THREE.DataTexture(new Uint8Array(4), 1, 1);

describe('createBakedMaterial', () => {
  it('reads the look of the uniforms it was made with: one set per mini, or one shared', () => {
    const bone = createLookUniforms(LOOK_PRESETS[1]!.look);
    const primer = createLookUniforms(DEFAULT_LOOK);
    const a = compile(createBakedMaterial(detail(), bone));
    const b = compile(createBakedMaterial(detail(), primer));
    const c = compile(createBakedMaterial(detail(), primer));
    expect(a.uniforms.uBase).toBe(bone.uBase);
    expect(b.uniforms.uBase).toBe(primer.uBase);
    expect(b.uniforms.uLook).toBe(primer.uLook);
    expect(a.uniforms.uBase!.value).not.toEqual(b.uniforms.uBase!.value);
    // Shared: one update reaches every mini made with the set, and none other.
    const before = (a.uniforms.uBase!.value as THREE.Vector3).clone();
    updateLookUniforms(primer, LOOK_PRESETS[2]!.look);
    expect(c.uniforms.uBase!.value).toBe(b.uniforms.uBase!.value);
    expect(a.uniforms.uBase!.value).toEqual(before);
  });

  it('puts the paint under the look when it has one, and compiles a program of its own', () => {
    const uniforms = createLookUniforms(DEFAULT_LOOK);
    const map = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const plainMaterial = createBakedMaterial(detail(), uniforms);
    const paintedMaterial = createBakedMaterial(detail(), uniforms, { map });
    const plain = compile(plainMaterial);
    const painted = compile(paintedMaterial);
    expect(plain.uniforms.uPaint).toBeUndefined();
    expect(plain.fragmentShader).not.toContain('uPaint');
    expect(painted.uniforms.uPaint!.value).toBe(map);
    expect(painted.fragmentShader).toContain('uniform sampler2D uPaint;');
    expect(painted.fragmentShader).toContain('mix( uBase, mtPaint.rgb, mtPaint.a )');
    // The look works on the coat, painted or not.
    for (const shader of [plain, painted])
      expect(shader.fragmentShader).toContain('vec3 mtCoat = mtBase * mtShadow;');
    expect(plainMaterial.customProgramCacheKey()).not.toBe(paintedMaterial.customProgramCacheKey());
    // The paint stays the consumer's.
    let disposed = false;
    map.addEventListener('dispose', () => (disposed = true));
    paintedMaterial.dispose();
    expect(disposed).toBe(false);
  });
});
