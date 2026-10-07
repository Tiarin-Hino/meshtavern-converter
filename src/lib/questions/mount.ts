import {
  findSourcePreset,
  fromAxisAngle,
  IDENTITY,
  MAX_PAIRS,
  multiply,
  pairsAllowed,
  SOURCE_PRESETS,
  turnAngleDeg,
  UP_AXES,
  type Answer,
  type AskOptions,
  type AskUp,
  type Box,
  type Fit,
  type Hit,
  type IndexedMesh,
  type MeetAction,
  type MeetQuestion,
  type OrientationOptions,
  type PatchSummary,
  type Question,
  type Rotation,
  type Shown,
  type ShownPatch,
  type Target,
  type UpAxis,
  type UpQuestion,
} from '../index';
import {
  LIFT_STEP_MM,
  partName,
  QUESTION_COPY,
  QUESTION_SENTENCES,
  TURN_STEP_DEG,
  type QuestionCopy,
} from './copy';
import { PAIR_COLOURS, QuestionScene } from './scene';

export { PAIR_COLOURS } from './scene';

/**
 * The question view (#119, design note `docs/design/questions-view.md`): what the page's `main.ts`
 * did at a question (#92, #93, #100), moved, so the page and a consumer such as the table's "add a
 * mini" dialog answer a conversion's questions with the same controls. The worker owns the marks
 * and decides every transform; the view draws what a `Question` says, sends what a finger did,
 * and shows what comes back.
 */

type Vec3 = [number, number, number];

/** A press is a tap when it moves no further and lasts no longer than this; else it orbits. _(proposals, #93)_ */
export const TAP_MAX_PX = 6;
export const TAP_MAX_MS = 400;
/** The brush: a dab every this many CSS pixels of a drag, this wide on the surface. _(proposals, patches §7.1)_ */
export const BRUSH_STEP_PX = 6;
export const BRUSH_RADIUS_MM = 1;
/** A finger held this long without moving turns the camera about the spot under it (#93). _(proposal)_ */
export const FOCUS_HOLD_MS = 500;
/** The width of the view's own panel over the scene, when no `controls` element is given: the page's panel. _(proposal)_ */
export const PANEL_WIDTH_PX = 360;

/** A meet question as the view keeps it: the pairs without their triangles, which the scene has. */
export type AskedMeet = Omit<MeetQuestion, 'pairs'> & {
  pairs: { on: PatchSummary | null; of: PatchSummary | null }[];
  name: string;
  serial: number;
};
/** A question as the view keeps it: without its meshes, with the name of what it is about and a serial per conversion. */
export type AskedQuestion = (UpQuestion & { name: string; serial: number }) | AskedMeet;
/**
 * At a meet question (#93, patches §7): the pair the next tap goes to, the brush and the eraser,
 * the parts pulled apart, and the part the final view's buttons move (null: the last marked).
 * The marks themselves are the worker's.
 */
export interface MeetUi {
  pair: number;
  brush: boolean;
  erase: boolean;
  apart: boolean;
  part: number | null;
}
const meetUi = (): MeetUi => ({
  pair: 0,
  brush: false,
  erase: false,
  apart: false,
  part: null,
});

/** Pitch tips the mini towards the camera's default view (about scene x), roll to the side (about z). */
export type TurnAxis = 'pitch' | 'roll';
const TURN_AXES: Record<TurnAxis, Vec3> = {
  pitch: [1, 0, 0],
  roll: [0, 0, 1],
};

/** What the view needs to word and answer one conversion's questions. */
export interface ConversionToAsk {
  /** The files' names in the order given to `convert` (`stl`, `secondStl`, `moreStl`). */
  names: readonly string[];
  /** The questions this conversion asks: what `convert` was given as `ask`. Decides which Confirm is the last. */
  ask: AskOptions;
  /** The orientation options the conversion was started with: what an untouched Confirm sends back. */
  orientation?: OrientationOptions;
  baseOrientation?: OrientationOptions;
  /** The source preset in force, by id; null or left out for none. */
  preset?: string | null;
}

export interface QuestionsOptions {
  /** The view's canvas fills this element: give it a size. */
  scene: HTMLElement;
  /** Where the controls go. Left out: a panel of the view's own over the scene's right edge. */
  controls?: HTMLElement;
  /** Words and sentences to replace, field by field. */
  copy?: Partial<QuestionCopy>;
  /** Called after every change the view shows: a question arrived or was answered, a turn is tried, a tool toggled, a pair selected. */
  onChange?: (state: QuestionsState) => void;
}

export interface QuestionsState {
  /** The question on screen, without its meshes, with the name of what it is about and a serial per conversion. Null when none. */
  question: AskedQuestion | null;
  /** At a meet question: the pair the next tap goes to, the brush and the eraser, the parts pulled apart, the part the final view moves. */
  meet: MeetUi;
  /** The turn being tried out at an up question: scene axes, after the rotation asked about. */
  turn: { turn: Rotation | null; turnDeg: number };
  /** The source preset in force at the question, by id; null for none. */
  preset: string | null;
}

export interface QuestionsView {
  /** What is on screen: replaced, not changed, on every change. */
  readonly state: QuestionsState;
  /** Begins a conversion's questions and returns the callback for `convert`'s fourth argument. */
  start(conversion: ConversionToAsk): AskUp;
  /** The conversion ended (done, cancelled, failed): whatever is shown leaves the screen, every waiting call resolves. */
  end(): void;
  /** Resolves once every mesh of the question on screen has all its chunks (#108); they are drawn from the next frame. */
  drawn(): Promise<void>;
  /** The figures of the view's last frame, for live figures beside the consumer's own. */
  rendered(): { triangles: number; drawCalls: number };
  // The answers: each resolves when the question that comes back is on screen, at once for the
  // answer that ends the questions.
  /** At an up question: shows how the file stands with these options (left out: the proposal). */
  answerUp(options?: OrientationOptions): Promise<void>;
  /** At an up question: confirms, with these options or, left out, what is on screen, a turn being tried out included. */
  confirmUp(options?: OrientationOptions): void;
  /** At a question about a pair: the other file is the base. */
  swapAtQuestion(): Promise<void>;
  /** At the base's question: this file is the base, or null: none, the files are parts of one figure. */
  chooseBase(file: number | null): Promise<void>;
  /** At an up question: the source preset's way, or none; the question comes again. Throws for an unknown id. */
  setPreset(id: string | null): Promise<void>;
  /** At a meet question: a tap on `file` at `point`, file coordinates, on pair `pair` (left out: the one selected). */
  tap(file: number, point: Vec3, pair?: number): Promise<void>;
  /** Brush dabs (or eraser dabs) of one drag on `file`, file coordinates. */
  brush(file: number, points: Vec3[], options?: { erase?: boolean; pair?: number }): Promise<void>;
  /** Selects the next pair, or one of the pairs: where the next tap goes. */
  addPair(): void;
  selectPair(k: number): void;
  /** Clears one pair, or everything: back to the proposal ("Start over"). */
  clearMarks(pair?: number): Promise<void>;
  undoMark(): Promise<void>;
  /** The pairs stop: put them together. The final view: back to the pairs. */
  fitMeeting(): Promise<void>;
  backToMarks(): Promise<void>;
  /** The final view: raises (positive) or lowers, turns, lets tilt or keeps upright what is fitted. */
  liftMeeting(mm: number): Promise<void>;
  turnMeeting(deg: number): Promise<void>;
  setTilt(mode: 'keep' | 'free' | null): Promise<void>;
  /** Confirms the stop on screen: the pairs (put together), or the final view (go on). */
  confirmMeet(): Promise<void>;
  /** Any action at a meet question, as the worker takes it. */
  answerMeet(action: MeetAction): Promise<void>;
  /** What a tap at canvas point (x, y), CSS pixels, would hit; nothing is marked. */
  pickAt(x: number, y: number): Promise<Hit | null>;
  /** Where a file's point is on the canvas, CSS pixels from its corner. */
  screenOf(file: number, point: Vec3): [number, number] | null;
  /** At a meet question: the camera turns about the spot under (x, y), as a right-click does; resolves with what was hit. */
  focusAt(x: number, y: number): Promise<Hit | null>;
  /** At a meet question: the camera frames one file, as its Look at button does. */
  focusFile(file: number): void;
  /** At an up question: turns the meshes by `deg` about the scene's x (pitch) or z (roll) axis; a preview, nothing is sent until Confirm. */
  turn(axis: TurnAxis, deg: number): void;
  resetTurn(): void;
  /** The camera on a sphere around what is shown; the material drawn as lines. For screenshots and tools. */
  setCamera(azimuthDeg: number, elevationDeg: number, zoom: number): void;
  setWireframe(on: boolean): void;
  /** Releases the renderer, the listeners and the elements the view made. */
  dispose(): void;
}

/** The view's element ids are unique per document: one view at a time. */
let mounted = false;

/**
 * Mounts the question view into the consumer's elements: its own canvas into `scene`, its controls
 * into `controls` (or a panel of its own over the scene). The stylesheet is
 * `meshtavern-converter/questions.css`, imported once by the consumer.
 */
export function mountQuestions(options: QuestionsOptions): QuestionsView {
  if (mounted) throw new Error('A question view is already mounted: one per document');
  mounted = true;
  return new View(options, () => (mounted = false));
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The controls, with the ids, attributes and nesting the page's index.html had (#92, #93). */
function template(copy: QuestionCopy): string {
  const t = (key: keyof typeof QUESTION_COPY): string => escapeHtml(copy[key]);
  const turnButtons = (['pitch', 'roll'] as const)
    .flatMap((axis) =>
      [-TURN_STEP_DEG, TURN_STEP_DEG].map(
        (deg) =>
          `<button type="button" data-turn="${axis}" data-deg="${deg}">${t(axis)} ${deg < 0 ? '−' : '+'}${TURN_STEP_DEG}°</button>`,
      ),
    )
    .join('');
  return `<section id="ask" aria-labelledby="ask-question" hidden>
<p id="ask-file" hidden></p>
<p id="ask-question">${t('askUp')}</p>
<p id="ask-found"></p>
<p id="ask-warning" hidden></p>
<label id="ask-base-choice" hidden>${t('base')} <select id="ask-base"></select></label>
<label><span>${t('source')}</span> <select id="ask-source"></select></label>
<label>${t('upAxis')} <select id="ask-up"></select></label>
<div id="ask-turn" role="group" aria-label="${t('turn')}">${turnButtons}<label class="check"><input id="ask-turn-by-hand" type="checkbox" /> ${t('turnByHand')}</label><span id="ask-pending" hidden></span><button id="ask-set-down" type="button">${t('askSetDown')}</button><button id="ask-reset" type="button">${t('askReset')}</button></div>
<button id="ask-swap" type="button" hidden>${t('swapPair')}</button>
<button id="ask-confirm" class="primary" type="button"></button>
</section>
<section id="meet" aria-labelledby="meet-question" hidden>
<p id="meet-question"></p>
<ul id="meet-parts" hidden></ul>
<div id="meet-marking" data-stage="pairs">
<ul id="meet-pairs" aria-label="${t('pairs')}"></ul>
<p id="meet-hint"></p>
<div id="meet-tools" role="group" aria-label="${t('marks')}"><button id="meet-add" type="button">${t('addPair')}</button><button id="meet-brush" type="button" aria-pressed="false">${t('brush')}</button><button id="meet-erase" type="button" aria-pressed="false">${t('erase')}</button><button id="meet-undo" type="button">${t('undo')}</button><button id="meet-clear" type="button">${t('startOver')}</button><button id="meet-apart" type="button" hidden>${t('pullApart')}</button></div>
</div>
<div id="meet-final" data-stage="fitted">
<p id="meet-placement"></p>
<div id="meet-adjust" role="group" aria-label="${t('adjustMeeting')}"><button type="button" data-meet-lift="1">${t('raise')} ${LIFT_STEP_MM} mm</button><button type="button" data-meet-lift="-1">${t('lower')} ${LIFT_STEP_MM} mm</button><button type="button" data-meet-turn="-${TURN_STEP_DEG}">${t('turn')} −${TURN_STEP_DEG}°</button><button type="button" data-meet-turn="${TURN_STEP_DEG}">${t('turn')} +${TURN_STEP_DEG}°</button><button id="meet-tilt" type="button" hidden></button></div>
<button id="meet-back" type="button">${t('backToMarking')}</button>
</div>
<div id="meet-look"><span>${t('lookAt')}</span><div id="meet-view" role="group" aria-label="${t('lookAt')}"></div><p id="meet-view-hint">${t('viewHint')}</p></div>
<button id="meet-confirm" class="primary" type="button"></button>
</section>`;
}

/** A finger or a button held on the canvas. */
interface Press {
  id: number;
  button: number;
  x: number;
  y: number;
  at: number;
  last: [number, number] | null;
  /** Set once a held finger turned the camera: its release is no tap. */
  focused: boolean;
  hold: number;
}

/** A patch's summary, without its triangles. */
const summaryOf = ({ file, areaMm2, centre, normal, flatness }: PatchSummary): PatchSummary => ({
  file,
  areaMm2,
  centre,
  normal,
  flatness,
});

class View implements QuestionsView {
  private readonly copy: QuestionCopy;
  private readonly scene: QuestionScene;
  private readonly hosts: HTMLElement[];
  /** The view's own panel, when no `controls` element was given. */
  private readonly panel: HTMLElement | null;
  private readonly onChange: ((state: QuestionsState) => void) | undefined;
  private readonly ask: {
    file: HTMLElement;
    section: HTMLElement;
    found: HTMLElement;
    warning: HTMLElement;
    up: HTMLSelectElement;
    turn: HTMLElement;
    turnByHand: HTMLInputElement;
    pending: HTMLElement;
    setDown: HTMLButtonElement;
    reset: HTMLButtonElement;
    swap: HTMLButtonElement;
    confirm: HTMLButtonElement;
    baseChoice: HTMLElement;
    base: HTMLSelectElement;
    source: HTMLSelectElement;
  };
  private readonly meetInputs: {
    section: HTMLElement;
    question: HTMLElement;
    parts: HTMLElement;
    marking: HTMLElement;
    pairs: HTMLElement;
    hint: HTMLElement;
    add: HTMLButtonElement;
    brush: HTMLButtonElement;
    erase: HTMLButtonElement;
    undo: HTMLButtonElement;
    clear: HTMLButtonElement;
    apart: HTMLButtonElement;
    final: HTMLElement;
    placement: HTMLElement;
    adjust: HTMLElement;
    tilt: HTMLButtonElement;
    back: HTMLButtonElement;
    view: HTMLElement;
    confirm: HTMLButtonElement;
  };

  /** The conversion asking, as `start` was given it. */
  private conversion: ConversionToAsk = { names: [], ask: {} };
  private question: AskedQuestion | null = null;
  private meet: MeetUi = meetUi();
  private turned: QuestionsState['turn'] = { turn: null, turnDeg: 0 };
  private preset: string | null = null;
  private current: QuestionsState;

  /**
   * The questions of a conversion (#92 design note §6, #93 §6): what the worker sent about each
   * file, kept until the last question is confirmed, and the answer the view owes it.
   */
  private readonly asking = {
    /** The welded meshes the worker sent, by file: each travels once per conversion. */
    meshes: [] as (IndexedMesh | undefined)[],
    /** Whether the scene shows a question's meshes, and what the camera last framed. */
    shown: false,
    framed: '',
    /** Answers the question on screen; null when none waits. */
    answer: null as ((answer: Answer) => void) | null,
    /**
     * The options the up question on screen was resolved from, as the worker has them: what
     * Confirm sends when nothing is being turned. `key` says for which role and file.
     */
    options: {} as OrientationOptions,
    key: '',
    /** The options the conversion started with; after a swap every question starts from the proposal. */
    sent: { orientation: {}, baseOrientation: {} } as {
      orientation: OrientationOptions;
      baseOrientation: OrientationOptions;
    },
    swapped: false,
    /** At a meet question: the patches of its pairs, for the scene (#93). */
    patches: [] as { on: ShownPatch | null; of: ShownPatch | null }[],
    serial: 0,
    /** Calls waiting for the next question on screen. */
    waiters: [] as (() => void)[],
  };
  /** Brush dabs waiting to be sent: one `brush` action per frame, while no answer is on its way. */
  private readonly brushing = { dabs: [] as Target[], frame: 0 };
  /** Fingers and buttons on the canvas: one paints with the brush on, two orbit. */
  private readonly pointers = new Set<number>();
  private press: Press | null = null;

  constructor(
    options: QuestionsOptions,
    private readonly released: () => void,
  ) {
    this.copy = { ...QUESTION_COPY, ...QUESTION_SENTENCES, ...options.copy };
    this.onChange = options.onChange;
    const sceneHost = options.scene;
    this.panel = options.controls ? null : document.createElement('div');
    const controls = options.controls ?? this.panel!;
    if (this.panel) {
      this.panel.className = 'mt-questions-panel';
      sceneHost.append(this.panel);
    }
    sceneHost.classList.add('mt-questions', 'mt-questions-scene');
    controls.classList.add('mt-questions', 'mt-questions-controls');
    this.hosts = [sceneHost, controls];
    // The chips' colours, from the one list the scene draws the patches with.
    for (const host of this.hosts)
      PAIR_COLOURS.forEach((colour, k) =>
        host.style.setProperty(`--pair-${k + 1}`, `#${colour.toString(16).padStart(6, '0')}`),
      );
    controls.innerHTML = template(this.copy);
    const $ = <E extends HTMLElement>(selector: string): E => controls.querySelector<E>(selector)!;
    this.ask = {
      section: $('#ask'),
      file: $('#ask-file'),
      found: $('#ask-found'),
      warning: $('#ask-warning'),
      up: $('#ask-up'),
      turn: $('#ask-turn'),
      turnByHand: $('#ask-turn-by-hand'),
      pending: $('#ask-pending'),
      setDown: $('#ask-set-down'),
      reset: $('#ask-reset'),
      swap: $('#ask-swap'),
      confirm: $('#ask-confirm'),
      baseChoice: $('#ask-base-choice'),
      base: $('#ask-base'),
      source: $('#ask-source'),
    };
    this.meetInputs = {
      section: $('#meet'),
      question: $('#meet-question'),
      parts: $('#meet-parts'),
      marking: $('#meet-marking'),
      pairs: $('#meet-pairs'),
      hint: $('#meet-hint'),
      add: $('#meet-add'),
      brush: $('#meet-brush'),
      erase: $('#meet-erase'),
      undo: $('#meet-undo'),
      clear: $('#meet-clear'),
      apart: $('#meet-apart'),
      final: $('#meet-final'),
      placement: $('#meet-placement'),
      adjust: $('#meet-adjust'),
      tilt: $('#meet-tilt'),
      back: $('#meet-back'),
      view: $('#meet-view'),
      confirm: $('#meet-confirm'),
    };
    this.scene = new QuestionScene(sceneHost);
    this.current = this.snapshot();
    this.wireAsk();
    this.wireMeet();
    this.wireCanvas();
  }

  get state(): QuestionsState {
    return this.current;
  }

  private snapshot(): QuestionsState {
    return {
      question: this.question,
      meet: this.meet,
      turn: this.turned,
      preset: this.preset,
    };
  }

  /** A fresh state for the consumer, after the view updated its elements and its scene. */
  private emit(): void {
    this.current = this.snapshot();
    this.onChange?.(this.current);
  }

  private setMeet(changes: Partial<MeetUi>): void {
    this.meet = { ...this.meet, ...changes };
  }

  start(conversion: ConversionToAsk): AskUp {
    this.conversion = conversion;
    Object.assign(this.asking, {
      meshes: [],
      shown: false,
      framed: '',
      answer: null,
      key: '',
      sent: {
        orientation: conversion.orientation ?? {},
        baseOrientation: conversion.baseOrientation ?? {},
      },
      swapped: false,
      patches: [],
      serial: 0,
    });
    this.question = null;
    this.meet = meetUi();
    this.turned = { turn: null, turnDeg: 0 };
    this.preset = conversion.preset ?? null;
    this.current = this.snapshot();
    return (question) => this.asked(question);
  }

  end(): void {
    // Cancelled or failed at a question: its meshes leave the screen too.
    this.asking.answer = null;
    this.question = null;
    this.meet = meetUi();
    this.scene.setBrush(false);
    this.brushing.dabs.length = 0;
    if (this.asking.shown) this.giveUpQuestion();
    if (this.ask.turnByHand.checked) {
      this.ask.turnByHand.checked = false;
      this.scene.setTurnGizmo(null);
    }
    this.showTurn(null);
    this.showQuestion();
    this.emit();
    for (const waiter of this.asking.waiters.splice(0)) waiter();
  }

  drawn(): Promise<void> {
    return this.scene.chunksAdded();
  }

  rendered(): { triangles: number; drawCalls: number } {
    return this.scene.info;
  }

  /** The question on screen when it is an up question. */
  private upQuestion(): (AskedQuestion & { kind: 'up' }) | null {
    const question = this.question;
    return question?.kind === 'up' ? question : null;
  }
  /** The question on screen when it is a meet question. */
  private meetQuestion(): (AskedQuestion & { kind: 'meet' }) | null {
    const question = this.question;
    return question?.kind === 'meet' ? question : null;
  }

  /** A file's name as the conversion gave it. */
  private nameOf(file: number | null): string {
    return file === null ? '' : (this.conversion.names[file] ?? `file ${file + 1}`);
  }

  /**
   * What the scene draws at a question: each entry of `shown` with the mesh the worker sent. The
   * camera frames it anew when other files are shown, or the figure is laid beside its base: not
   * when the same files only move a little, so a change tried out is seen from where the person
   * looked.
   */
  private drawShown(shown: readonly Shown[], box: Box, layout = ''): void {
    const entries = shown.flatMap((entry) => {
      const mesh = this.asking.meshes[entry.file];
      return mesh ? [{ ...entry, mesh }] : [];
    });
    // ...or when what is shown grew or shrank by half or more (a part joined from far away).
    const across = Math.max(...box.max.map((max, k) => max - box.min[k]!));
    const scale = Math.round(Math.log2(Math.max(across, 1)));
    const framing = `${entries.map((entry) => entry.file).join(',')}${layout}:${scale}`;
    this.scene.showShown(entries, box, framing !== this.asking.framed);
    this.asking.framed = framing;
    this.asking.shown = true;
  }

  /** The worker's question: the meshes to the scene, the words to the controls, and wait for the person. */
  private asked(question: Question): Promise<Answer> {
    const asking = this.asking;
    return new Promise((resolve) => {
      for (const { file, mesh } of question.meshes) asking.meshes[file] = mesh;
      asking.answer = resolve;
      if (question.kind === 'up') {
        const key = `${question.role}:${question.file}`;
        if (key !== asking.key) {
          asking.key = key;
          asking.options = asking.swapped
            ? {}
            : question.role === 'base'
              ? asking.sent.baseOrientation
              : asking.sent.orientation;
        }
        const name =
          question.role === 'base'
            ? this.nameOf(question.file)
            : question.roles.figureFiles.map((file) => this.nameOf(file)).join(' + ');
        this.question = {
          ...question,
          meshes: [],
          name,
          serial: ++asking.serial,
        };
      } else {
        const before = this.question;
        // A new meeting starts with the first pair selected and the tools off.
        if (before?.kind !== 'meet' || before.about !== question.about) {
          // The parts start laid apart, as a figure beside its base (PM decision 2026-10-01).
          this.meet = { ...meetUi(), apart: question.about === 'parts' };
          this.scene.setBrush(false);
        }
        if (question.proposed) this.setMeet({ pair: 0 });
        asking.patches = question.pairs;
        const figure = question.roles.figureFiles.map((file) => this.nameOf(file)).join(' + ');
        const name =
          question.about === 'base'
            ? `${figure} + ${this.nameOf(question.roles.baseFile)}`
            : figure;
        const pairs = question.pairs.map(({ on, of }) => ({
          on: on && summaryOf(on),
          of: of && summaryOf(of),
        }));
        this.question = {
          ...question,
          meshes: [],
          pairs,
          name,
          serial: ++asking.serial,
        };
      }
      this.showTurn(null);
      this.showQuestion();
      this.emit();
      for (const waiter of asking.waiters.splice(0)) waiter();
      // Dabs painted while the worker answered go now.
      if (question.kind === 'meet' && this.brushing.dabs.length > 0) this.flushBrush();
    });
  }

  /** Whether confirming this question ends the questions: what follows depends on what is asked. */
  private lastQuestion(question: AskedQuestion): boolean {
    const asks = this.conversion.ask;
    const { up, baseUp, meet } = {
      up: asks.up !== false,
      baseUp: asks.baseUp !== false,
      meet: asks.meet !== false,
    };
    const withBase = question.roles.baseFile !== null;
    if (question.kind === 'meet')
      return question.about === 'base' || (withBase ? !baseUp && !up && !meet : !up);
    if (question.role === 'base') return !up && !meet;
    if (question.role === 'figure') return !meet;
    return true;
  }

  /** Whether the axis comes from the source preset: one is set, and these options choose no axis or turn. */
  private upFromPreset(options: OrientationOptions): boolean {
    return this.preset !== null && options.up === undefined && options.rotation === undefined;
  }

  /** The controls and the scene, for the question on screen; both sections hidden without one. */
  private showQuestion(): void {
    const question = this.question;
    this.ask.section.hidden = question?.kind !== 'up';
    this.meetInputs.section.hidden = question?.kind !== 'meet';
    if (!question) return;
    const { copy } = this;
    const ask = this.ask;
    const names = this.conversion.names;
    const confirmLabel = (label: string): string =>
      this.lastQuestion(question) ? copy.confirmUp : label;
    if (question.kind === 'up') {
      this.drawShown(question.shown, question.box);
      this.scene.setPatches([]);
      const file = copy.describeAskedFile(question.role, question.name);
      ask.file.hidden = file === null;
      ask.file.textContent = file ?? '';
      ask.found.textContent = copy.describeUp(question, this.upFromPreset(this.asking.options));
      // The base's question is where the roles are confirmed: the warning of the guess goes there.
      const warning =
        question.role === 'base' ? copy.describePairWarning(question.warnings, 'question') : null;
      ask.warning.hidden = warning === null;
      ask.warning.textContent = warning ?? '';
      ask.up.value = question.orientation.up;
      ask.source.value = this.preset ?? '';
      ask.swap.hidden = question.role === 'mini' || names.length !== 2;
      // Which file is the base, or none (#93): at the base's question, or for parts without one.
      const choosesBase =
        names.length >= 2 &&
        (question.role === 'base' ||
          (question.role === 'mini' && question.roles.baseFile === null));
      ask.baseChoice.hidden = !choosesBase;
      if (choosesBase) {
        ask.base.replaceChildren(
          ...names.map((name, file) => new Option(partName(name), String(file))),
          new Option(copy.noBase, ''),
        );
        ask.base.value = String(question.roles.baseFile ?? '');
      }
      ask.confirm.textContent =
        question.role === 'base'
          ? confirmLabel(copy.confirmBaseUp)
          : question.role === 'figure'
            ? confirmLabel(copy.confirmFigureUp)
            : copy.confirmUp;
      return;
    }
    const meet = this.meetInputs;
    // Where the parts meet (#93, patches §7): the pairs with the parts apart, then put together.
    const pairsStop = question.stage === 'pairs';
    const pulled = pairsStop && this.showsApart(question) && question.apart;
    this.drawShown(
      pulled ? pulled.shown : question.shown,
      pulled ? pulled.box : question.box,
      `:${question.stage}${pulled ? ':apart' : ''}`,
    );
    this.showViewButtons(pulled ? pulled.shown : question.shown);
    this.scene.setPatches(
      this.asking.patches.flatMap(({ on, of }, pair) =>
        [on, of].flatMap((side) =>
          side
            ? [
                {
                  file: side.file,
                  triangles: side.triangles,
                  pair,
                  proposed: question.proposed,
                },
              ]
            : [],
        ),
      ),
    );
    meet.question.textContent = pairsStop
      ? copy.askPairs
      : question.about === 'parts'
        ? copy.askParts
        : copy.askMeet;
    meet.marking.hidden = !pairsStop;
    meet.final.hidden = pairsStop;
    // The parts' lines: at the final view of the parts a line selects what Raise, Lower and Turn move.
    meet.parts.hidden = question.about !== 'parts';
    if (question.about === 'parts') {
      const touching = new Set(
        question.proposed ? question.pairs.flatMap(({ on, of }) => [on?.file, of?.file]) : [],
      );
      meet.parts.replaceChildren(
        ...question.parts.map((part) => {
          const item = document.createElement('li');
          const apartFile =
            question.proposed && part.source === 'files' && !touching.has(part.file);
          item.textContent = copy.describePart(part, this.nameOf(part.file), apartFile);
          if (!pairsStop && part.source === 'marked') {
            item.dataset.part = String(part.file);
            item.toggleAttribute('data-selected', part.file === this.movingPart(question));
            item.addEventListener('click', () => {
              this.setMeet({ part: part.file });
              this.showQuestion();
              this.emit();
            });
          }
          return item;
        }),
      );
    }
    if (pairsStop) {
      this.showPairChips(question);
      const unplaced = this.unplacedParts(question);
      meet.hint.textContent =
        unplaced > 0 && !question.proposed && !question.note
          ? copy.markEveryPart
          : copy.describePairs(question);
      // Parts laid out for print have no place of their own to show.
      meet.apart.hidden =
        question.about !== 'parts' || !question.apart || question.inPlace === false;
      meet.apart.textContent = this.meet.apart ? copy.showInPlace : copy.pullApart;
      meet.brush.setAttribute('aria-pressed', String(this.meet.brush));
      meet.erase.setAttribute('aria-pressed', String(this.meet.erase));
      meet.add.disabled =
        question.pairs.length >= this.pairsOf(question) || this.meet.pair >= question.pairs.length;
      meet.undo.disabled = question.proposed && question.marks === null;
      meet.clear.disabled = question.proposed;
      meet.confirm.textContent = copy.confirmPairs;
      // A pair with one side marked is not a pair yet; a kit laid out for print is a pile until
      // every part is marked.
      meet.confirm.disabled =
        unplaced > 0 || question.pairs.some(({ on, of }) => (on === null) !== (of === null));
      return;
    }
    const placement = question.placement;
    meet.placement.hidden = question.about !== 'base' || !placement;
    // During a conversion the base file's units are not known yet: the placement is said in them.
    meet.placement.textContent = placement ? copy.describePlacement(placement) : '';
    // Raise, Lower and Turn move a marked part, or the automatic placement on a base (§15 Q7).
    const fit = this.fitOf(question);
    meet.adjust.hidden = question.about === 'parts' && this.movingPart(question) === null;
    meet.tilt.hidden = fit === null;
    meet.tilt.textContent = fit?.kept === 'free' ? copy.keepUpright : copy.letTilt;
    meet.confirm.disabled = false;
    meet.confirm.textContent =
      question.about === 'parts' ? confirmLabel(copy.confirmParts) : copy.confirmUp;
  }

  /** One chip per pair at the pairs stop, in the pair's colour; the selected one takes the next tap. */
  private showPairChips(question: AskedMeet): void {
    // A chip for each pair, and one for a new pair once Add a pair selected it; none before anything is marked.
    const count = Math.min(
      this.pairsOf(question),
      question.pairs.length +
        (question.pairs.length > 0 && this.meet.pair >= question.pairs.length ? 1 : 0),
    );
    const side = (patch: PatchSummary | null): string =>
      patch ? partName(this.nameOf(patch.file)) : '…';
    const chips: HTMLElement[] = [];
    for (let k = 0; k < count; k++) {
      const pair = question.pairs[k];
      const item = document.createElement('li');
      item.style.setProperty('--chip', `var(--pair-${(k % MAX_PAIRS) + 1})`);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.pair = String(k);
      chip.setAttribute('aria-pressed', String(k === this.meet.pair));
      chip.textContent = `${k + 1}  ${side(pair?.on ?? null)} · ${side(pair?.of ?? null)}${question.proposed && pair ? `  ${this.copy.proposed}` : ''}`;
      chip.addEventListener('click', () => this.selectPair(k));
      item.append(chip);
      // A proposed pair can be dropped too: the rest of the proposal stays, to edit.
      if (pair) {
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'chip-clear';
        clear.setAttribute('aria-label', `${this.copy.clearPair} ${k + 1}`);
        clear.textContent = '×';
        clear.addEventListener('click', () => void this.sendMeet({ do: 'clear', pair: k }));
        item.append(clear);
      }
      chips.push(item);
    }
    this.meetInputs.pairs.replaceChildren(...chips);
  }

  /** The part Raise, Lower and Turn move at the final view of the parts: the one selected, else the last marked. */
  private movingPart(question: AskedMeet): number | null {
    const marked = question.parts.filter((part) => part.source === 'marked').map((p) => p.file);
    if (this.meet.part !== null && marked.includes(this.meet.part)) return this.meet.part;
    return marked.at(-1) ?? null;
  }

  /** How the marked placement on screen was fitted: the meeting's, or the moving part's; null when nothing is marked. */
  private fitOf(question: AskedMeet): Fit | null {
    if (question.about === 'base') return question.placement?.marks?.fit ?? null;
    const part = this.movingPart(question);
    return question.parts.find((entry) => entry.file === part)?.joint?.fit ?? null;
  }

  /** Whether the pairs stop shows the parts apart: as the person chose, always for parts laid out for print. */
  private showsApart(question: AskedMeet): boolean {
    return this.meet.apart || question.inPlace === false;
  }

  /**
   * The parts of a kit laid out for print that no complete pair places yet: they lie at the
   * origin, piled on the body. Zero for every other question.
   */
  private unplacedParts(question: AskedMeet): number {
    if (question.about !== 'parts' || question.inPlace !== false) return 0;
    const placed = new Set(question.pairs.flatMap(({ on, of }) => (on && of ? [of.file] : [])));
    return question.roles.figureFiles.slice(1).filter((file) => !placed.has(file)).length;
  }

  /** How many pairs the meet question on screen takes. */
  private pairsOf(question: AskedMeet): number {
    return pairsAllowed(question.about, question.roles.figureFiles.length);
  }

  selectPair(k: number): void {
    const question = this.meetQuestion();
    if (!question) return;
    this.setMeet({
      pair: Math.max(0, Math.min(k, question.pairs.length, this.pairsOf(question) - 1)),
    });
    this.showQuestion();
    this.emit();
  }

  addPair(): void {
    this.selectPair(this.meetQuestion()?.pairs.length ?? 0);
  }

  /** Gives up the question's meshes: the scene releases them and the view drops its arrays (§4.3). */
  private giveUpQuestion(): void {
    this.asking.meshes = [];
    this.asking.patches = [];
    this.asking.shown = false;
    this.asking.framed = '';
    this.scene.clear();
  }

  /** Whether an action at a meet question ends it: the final view confirmed, or a kit without pairs confirmed at once. */
  private endsMeeting(question: AskedMeet, action: MeetAction): boolean {
    if (action.do !== 'confirm' && action.do !== 'fit') return false;
    if (question.stage === 'fitted') return action.do === 'confirm';
    // A kit in place has no final view of its parts (§15 Q5): its pairs are the picture.
    const marked = question.marks !== null && question.pairs.some(({ on, of }) => on && of);
    return question.about === 'parts' && !marked;
  }

  /** Answers the question on screen. False when none waits. */
  private answerQuestion(answer: Answer): boolean {
    const resolve = this.asking.answer;
    const question = this.question;
    if (!resolve || !question) return false;
    this.asking.answer = null;
    const restart = answer.kind === 'up' && (answer.swap || answer.baseFile !== undefined);
    if (answer.kind === 'up' && !restart && !answer.confirm)
      this.asking.options = answer.orientation;
    if (restart) this.asking.swapped = true;
    const ends =
      answer.kind === 'up'
        ? answer.confirm
        : question.kind === 'meet' && this.endsMeeting(question, answer.action);
    if (ends || restart) {
      // After the last Confirm the conversion runs as it does without a question (PM decision).
      if (ends && this.lastQuestion(question)) this.giveUpQuestion();
      this.question = null;
      this.showTurn(null);
      this.showQuestion();
      this.emit();
    }
    resolve(answer);
    return true;
  }

  /** The rotation on screen at an up question: the one asked about, with a turn being tried out. */
  private rotationAtQuestion(): Rotation | null {
    const question = this.upQuestion();
    if (!question) return null;
    const { turn } = this.turned;
    return turn ? multiply(turn, question.orientation.rotation) : question.orientation.rotation;
  }

  confirmUp(options?: OrientationOptions): void {
    if (!this.upQuestion()) return;
    const orientation =
      options ??
      (this.turned.turn ? { rotation: this.rotationAtQuestion()! } : this.asking.options);
    this.answerQuestion({ kind: 'up', orientation, confirm: true });
  }

  /** An answer that brings the next question; resolves when it is on screen. */
  private answerAndWait(answer: Answer): Promise<void> {
    return new Promise((resolve) => {
      this.asking.waiters.push(resolve);
      if (!this.answerQuestion(answer)) {
        this.asking.waiters.pop();
        resolve();
      }
    });
  }

  answerUp(options: OrientationOptions = {}): Promise<void> {
    return this.answerAndWait({
      kind: 'up',
      orientation: options,
      confirm: false,
    });
  }

  swapAtQuestion(): Promise<void> {
    return this.answerAndWait({
      kind: 'up',
      orientation: {},
      confirm: false,
      swap: true,
    });
  }

  chooseBase(file: number | null): Promise<void> {
    return this.answerAndWait({
      kind: 'up',
      orientation: {},
      confirm: false,
      baseFile: file,
    });
  }

  /**
   * Picks a source preset, or none, at an up question (#100 design note §5): the question comes
   * again, the file standing the preset's way.
   */
  setPreset(id: string | null): Promise<void> {
    const preset = id === null ? null : findSourcePreset(id);
    if (id !== null && !preset) throw new Error(`No source preset "${id}"`);
    const question = this.upQuestion();
    if (!question) return Promise.resolve();
    // At a pair's figure the base is asked again under the preset: both start from it.
    if (question.role === 'figure') this.asking.swapped = true;
    this.preset = id;
    return this.answerAndWait({
      kind: 'up',
      orientation: {},
      confirm: false,
      preset,
    });
  }

  /**
   * What the person did at a meet question (#93, patches §5.6): the worker applies it and the
   * question comes back. Resolves when it is on screen; at once for the answer that ends the
   * meeting, after which the conversion goes on.
   */
  private sendMeet(action: MeetAction): Promise<void> {
    const question = this.meetQuestion();
    if (!question) return Promise.resolve();
    const answer: Answer = { kind: 'meet', action };
    if (this.endsMeeting(question, action)) {
      this.answerQuestion(answer);
      return Promise.resolve();
    }
    return this.answerAndWait(answer);
  }

  answerMeet(action: MeetAction): Promise<void> {
    return this.sendMeet(action);
  }

  tap(file: number, point: Vec3, pair = this.meet.pair): Promise<void> {
    return this.sendMeet({ do: 'tap', at: { file, point }, pair });
  }

  brush(
    file: number,
    points: Vec3[],
    { erase = false, pair = this.meet.pair }: { erase?: boolean; pair?: number } = {},
  ): Promise<void> {
    return this.sendMeet({
      do: 'brush',
      at: points.map((point) => ({ file, point })),
      pair,
      radiusMm: BRUSH_RADIUS_MM,
      ...(erase && { erase: true }),
    });
  }

  clearMarks(pair?: number): Promise<void> {
    return this.sendMeet({ do: 'clear', ...(pair !== undefined && { pair }) });
  }

  undoMark(): Promise<void> {
    return this.sendMeet({ do: 'undo' });
  }

  fitMeeting(): Promise<void> {
    return this.sendMeet({ do: 'fit' });
  }

  backToMarks(): Promise<void> {
    return this.sendMeet({ do: 'back' });
  }

  confirmMeet(): Promise<void> {
    return this.sendMeet({ do: 'confirm' });
  }

  liftMeeting(mm: number): Promise<void> {
    return this.nudge({ liftMm: mm });
  }

  turnMeeting(deg: number): Promise<void> {
    return this.nudge({ turnDeg: deg });
  }

  setTilt(mode: 'keep' | 'free' | null): Promise<void> {
    return this.nudge({ turn: mode });
  }

  /** A ray from the camera through a canvas point, as the worker reads it: in the layout on screen. */
  private targetAt(x: number, y: number): Target | null {
    const ray = this.scene.rayAt(x, y);
    if (!ray) return null;
    const question = this.meetQuestion();
    const apart =
      question?.stage === 'pairs' && this.showsApart(question) && question.apart !== null;
    return { ray, ...(apart && { apart: true }) };
  }

  /** A tap at canvas point (x, y) at the pairs stop: the surface around it, on the pair selected. */
  private tapAt(x: number, y: number): Promise<void> {
    const question = this.meetQuestion();
    const at = this.targetAt(x, y);
    if (!question || question.stage !== 'pairs' || !at) return Promise.resolve();
    return this.sendMeet({ do: 'tap', at, pair: this.meet.pair });
  }

  private flushBrush(): void {
    this.brushing.frame = 0;
    const question = this.meetQuestion();
    if (this.brushing.dabs.length === 0 || !question || !this.asking.answer) return;
    const at = this.brushing.dabs.splice(0);
    void this.sendMeet({
      do: 'brush',
      at,
      pair: this.meet.pair,
      radiusMm: BRUSH_RADIUS_MM,
      ...(this.meet.erase && { erase: true }),
    });
  }

  private queueDab(x: number, y: number): void {
    const at = this.targetAt(x, y);
    if (!at) return;
    this.brushing.dabs.push(at);
    this.brushing.frame ||= requestAnimationFrame(() => this.flushBrush());
  }

  async pickAt(x: number, y: number): Promise<Hit | null> {
    const at = this.targetAt(x, y);
    if (!at) return null;
    await this.sendMeet({ do: 'pick', at });
    return this.meetQuestion()?.picked ?? null;
  }

  /**
   * Turns the camera about the spot under canvas point (x, y) at a meet question (#93): the worker
   * says what is there, the scene moves the orbit's centre to it. Resolves with what was hit.
   */
  async focusAt(x: number, y: number): Promise<Hit | null> {
    const at = this.targetAt(x, y);
    if (!at || !this.meetQuestion()) return null;
    await this.sendMeet({ do: 'pick', at });
    const hit = this.meetQuestion()?.picked ?? null;
    if (hit) this.scene.focusOn(hit.file, hit.point);
    return hit;
  }

  screenOf(file: number, point: Vec3): [number, number] | null {
    return this.scene.screenOf(file, point);
  }

  focusFile(file: number): void {
    this.scene.focusFile(file);
  }

  /** The Look at buttons of a meet question: each file shown, and all of them. */
  private showViewButtons(shown: readonly Shown[]): void {
    const buttons = shown.map(({ file }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = partName(this.nameOf(file));
      button.addEventListener('click', () => this.scene.focusFile(file));
      return button;
    });
    const all = document.createElement('button');
    all.type = 'button';
    all.textContent = this.copy.viewAll;
    all.addEventListener('click', () => this.scene.setCamera(34, 22, 1));
    this.meetInputs.view.replaceChildren(...buttons, all);
  }

  /** Raises, lowers, turns or lets tilt what is fitted at the final view. */
  private nudge(change: {
    liftMm?: number;
    turnDeg?: number;
    turn?: 'keep' | 'free' | null;
  }): Promise<void> {
    const question = this.meetQuestion();
    if (!question) return Promise.resolve();
    const part = question.about === 'parts' ? this.movingPart(question) : null;
    return this.sendMeet({
      do: 'nudge',
      ...change,
      ...(part !== null && { part }),
    });
  }

  /** Shows a turn being tried out at an up question, on the meshes and in words; null drops it. */
  private showTurn(turn: Rotation | null): void {
    const deg = turn ? turnAngleDeg(turn) : 0;
    this.turned = { turn: deg > 0 ? turn : null, turnDeg: deg };
    this.scene.setTurn(this.turned.turn);
    const pending = this.copy.describeAskPending(this.turned.turn ? deg : 0);
    this.ask.pending.hidden = pending === null;
    this.ask.pending.textContent = pending ?? '';
  }

  turn(axis: TurnAxis, deg: number): void {
    if (!this.upQuestion()) return;
    this.showTurn(multiply(fromAxisAngle(TURN_AXES[axis], deg), this.turned.turn ?? IDENTITY));
    this.emit();
  }

  resetTurn(): void {
    this.showTurn(null);
    this.emit();
  }

  setCamera(azimuthDeg: number, elevationDeg: number, zoom: number): void {
    this.scene.setCamera(azimuthDeg, elevationDeg, zoom);
  }

  setWireframe(on: boolean): void {
    this.scene.setWireframe(on);
  }

  // The up question's controls (#92): each change is an answer the worker resolves and asks again
  // with; the turn buttons are a preview; Confirm converts.
  private wireAsk(): void {
    const ask = this.ask;
    ask.up.replaceChildren(...UP_AXES.map((axis) => new Option(axis, axis)));
    ask.source.replaceChildren(
      new Option(this.copy.noPreset, ''),
      ...SOURCE_PRESETS.map((preset) => new Option(preset.label, preset.id)),
    );
    ask.source.addEventListener('change', () => void this.setPreset(ask.source.value || null));
    ask.up.addEventListener('change', () =>
      this.answerQuestion({
        kind: 'up',
        orientation: { up: ask.up.value as UpAxis },
        confirm: false,
      }),
    );
    for (const button of ask.turn.querySelectorAll<HTMLButtonElement>('[data-turn]')) {
      button.addEventListener('click', () =>
        this.turn(button.dataset.turn as TurnAxis, Number(button.dataset.deg ?? TURN_STEP_DEG)),
      );
    }
    ask.turnByHand.addEventListener('change', () =>
      this.scene.setTurnGizmo(
        ask.turnByHand.checked
          ? (turned) => {
              this.showTurn(turned);
              this.emit();
            }
          : null,
      ),
    );
    ask.setDown.addEventListener('click', () => {
      const rotation = this.rotationAtQuestion();
      if (rotation)
        this.answerQuestion({
          kind: 'up',
          orientation: { rotation, setDown: true },
          confirm: false,
        });
    });
    ask.reset.addEventListener('click', () =>
      this.answerQuestion({ kind: 'up', orientation: {}, confirm: false }),
    );
    ask.swap.addEventListener('click', () =>
      this.answerQuestion({
        kind: 'up',
        orientation: {},
        confirm: false,
        swap: true,
      }),
    );
    ask.confirm.addEventListener('click', () => this.confirmUp());
    ask.base.addEventListener('change', () =>
      this.answerQuestion({
        kind: 'up',
        orientation: {},
        confirm: false,
        baseFile: ask.base.value === '' ? null : Number(ask.base.value),
      }),
    );
  }

  // Where the parts meet (#93, patches §7): the pairs stop's tools, the final view's buttons.
  private wireMeet(): void {
    const meet = this.meetInputs;
    meet.add.addEventListener('click', () => this.addPair());
    meet.brush.addEventListener('click', () => {
      const brush = !this.meet.brush;
      this.setMeet({ brush, ...(!brush && { erase: false }) });
      this.scene.setBrush(this.meet.brush);
      this.showQuestion();
      this.emit();
    });
    meet.erase.addEventListener('click', () => {
      const erase = !this.meet.erase;
      // Erasing is a brush that takes away.
      this.setMeet({ erase, ...(erase && { brush: true }) });
      this.scene.setBrush(this.meet.brush);
      this.showQuestion();
      this.emit();
    });
    meet.undo.addEventListener('click', () => void this.sendMeet({ do: 'undo' }));
    meet.clear.addEventListener('click', () => void this.sendMeet({ do: 'clear' }));
    meet.apart.addEventListener('click', () => {
      this.setMeet({ apart: !this.meet.apart });
      this.showQuestion();
      this.emit();
    });
    for (const button of meet.adjust.querySelectorAll<HTMLButtonElement>('[data-meet-lift]'))
      button.addEventListener(
        'click',
        () =>
          void this.nudge({
            liftMm: Number(button.dataset.meetLift) * LIFT_STEP_MM,
          }),
      );
    for (const button of meet.adjust.querySelectorAll<HTMLButtonElement>('[data-meet-turn]'))
      button.addEventListener(
        'click',
        () => void this.nudge({ turnDeg: Number(button.dataset.meetTurn) }),
      );
    meet.tilt.addEventListener('click', () => {
      const question = this.meetQuestion();
      const fit = question && this.fitOf(question);
      if (fit) void this.nudge({ turn: fit.kept === 'free' ? 'keep' : 'free' });
    });
    meet.back.addEventListener('click', () => void this.sendMeet({ do: 'back' }));
    meet.confirm.addEventListener('click', () => void this.sendMeet({ do: 'confirm' }));
  }

  /**
   * Fingers and buttons on the view's canvas (#93): a tap within `TAP_MAX_PX` and `TAP_MAX_MS`
   * marks, a right-click or a finger held `FOCUS_HOLD_MS` turns the view about the spot, a drag
   * with the brush on paints, anything else orbits.
   */
  private wireCanvas(): void {
    const canvas = this.scene.canvas;
    const canvasPoint = (event: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const endPress = (): void => {
      if (this.press) clearTimeout(this.press.hold);
      this.press = null;
    };
    canvas.addEventListener('pointerdown', (event) => {
      this.pointers.add(event.pointerId);
      endPress();
      // A second finger orbits: the first one's drag is not a tap or a stroke any more.
      if (this.pointers.size !== 1 || (event.button !== 0 && event.button !== 2)) return;
      const [x, y] = canvasPoint(event);
      const held: Press = {
        id: event.pointerId,
        button: event.button,
        x: event.clientX,
        y: event.clientY,
        at: performance.now(),
        last: null,
        focused: false,
        hold: 0,
      };
      // A finger held still on a part turns the view about it.
      if (event.pointerType === 'touch')
        held.hold = window.setTimeout(() => {
          if (this.press !== held || held.last) return;
          held.focused = true;
          void this.focusAt(x, y);
        }, FOCUS_HOLD_MS);
      this.press = held;
    });
    canvas.addEventListener('pointermove', (event) => {
      const press = this.press;
      if (!press || press.id !== event.pointerId) return;
      const far = Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_MAX_PX;
      if (far) clearTimeout(press.hold);
      if (press.button !== 0 || !this.meet.brush || this.meetQuestion()?.stage !== 'pairs') return;
      if (!press.last && !far) return;
      const [x, y] = canvasPoint(event);
      if (press.last && Math.hypot(x - press.last[0], y - press.last[1]) < BRUSH_STEP_PX) return;
      press.last = [x, y];
      this.queueDab(x, y);
    });
    const release = (event: PointerEvent): void => {
      this.pointers.delete(event.pointerId);
      const down = this.press;
      if (!down || down.id !== event.pointerId) return;
      endPress();
      if (event.type !== 'pointerup' || down.last || down.focused || !this.meetQuestion()) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      if (moved > TAP_MAX_PX || performance.now() - down.at > TAP_MAX_MS) return;
      // A right-click turns the view about the spot; a tap marks it.
      if (down.button === 2) void this.focusAt(...canvasPoint(event));
      else void this.tapAt(...canvasPoint(event));
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  dispose(): void {
    this.end();
    if (this.press) clearTimeout(this.press.hold);
    if (this.brushing.frame) cancelAnimationFrame(this.brushing.frame);
    this.scene.dispose();
    const [sceneHost, controls] = this.hosts as [HTMLElement, HTMLElement];
    controls.replaceChildren();
    this.panel?.remove();
    sceneHost.classList.remove('mt-questions', 'mt-questions-scene');
    controls.classList.remove('mt-questions', 'mt-questions-controls');
    for (const host of this.hosts)
      for (let k = 1; k <= PAIR_COLOURS.length; k++) host.style.removeProperty(`--pair-${k}`);
    this.released();
  }
}
