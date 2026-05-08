import { initJsPsych } from "https://cdn.jsdelivr.net/npm/jspsych@8.0.0/+esm";
import HtmlButtonResponsePlugin from "https://cdn.jsdelivr.net/npm/@jspsych/plugin-html-button-response@2.0.0/+esm";
import HtmlKeyboardResponsePlugin from "https://cdn.jsdelivr.net/npm/@jspsych/plugin-html-keyboard-response@2.0.0/+esm";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// =============================================================================
// CONFIG — edit these per experiment
// =============================================================================

const EXPERIMENT_COLLECTION = "vis-guidelines-pilot";

// Paste your web app's Firebase configuration here (Project settings → General →
// Your apps → SDK setup and configuration → Config). While these values are
// placeholders, the experiment runs in OFFLINE_MODE: trials are logged to the
// console instead of Firestore so you can preview the UI.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCMWifly8RpRWOiZZNRGzfRY1zEx7DBMos",
  authDomain: "svrl-vis-guidelines.firebaseapp.com",
  projectId: "svrl-vis-guidelines",
  storageBucket: "svrl-vis-guidelines.firebasestorage.app",
  messagingSenderId: "528856330293",
  appId: "1:528856330293:web:b087ceef19468bea10017c",
  measurementId: "G-DR45EM7WN4",
};

// =============================================================================

const OFFLINE_MODE = FIREBASE_CONFIG.apiKey === "TODO";

// ---------- helpers ----------

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sampleRandomTriplets(words, n) {
  // Sample with replacement across trials but enforce head ≠ left ≠ right within a trial.
  const out = [];
  for (let i = 0; i < n; i++) {
    const [head, left, right] = shuffle(words).slice(0, 3);
    out.push({ head, left, right });
  }
  return out;
}

// ---------- Firebase setup ----------

let docRef = null;
let participantId = null;

if (!OFFLINE_MODE) {
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const cred = await signInAnonymously(auth);
  participantId = cred.user.uid;
  docRef = doc(db, EXPERIMENT_COLLECTION, participantId);
  await setDoc(
    docRef,
    {
      participantId,
      collection: EXPERIMENT_COLLECTION,
      startedAt: serverTimestamp(),
      userAgent: navigator.userAgent,
      trials: [],
    },
    { merge: true }
  );
} else {
  console.warn(
    "[OFFLINE_MODE] Firebase config is unset — trial data will be logged to console only."
  );
  participantId = "offline-" + Math.random().toString(36).slice(2, 10);
}

async function recordTrial(trial) {
  if (OFFLINE_MODE) {
    console.log("[trial]", trial);
    return;
  }
  try {
    await updateDoc(docRef, { trials: arrayUnion(trial) });
  } catch (err) {
    console.error("Firestore write failed; backing up to localStorage:", err);
    const key = `vis_backup_${participantId}`;
    const backup = JSON.parse(localStorage.getItem(key) || "[]");
    backup.push(trial);
    localStorage.setItem(key, JSON.stringify(backup));
  }
}

// ---------- build trial list ----------

const stimuli = await fetch("./stimuli.json").then((r) => r.json());

const randomTrials = sampleRandomTriplets(
  stimuli.words,
  stimuli.n_random_trials
).map((t) => ({ ...t, type: "random" }));
const validationTrials = stimuli.validation_triplets.map((t) => ({
  ...t,
  type: "validation",
}));
const catchTrials = stimuli.catch_triplets.map((t) => ({
  ...t,
  type: "catch",
}));
const allTrials = shuffle([...randomTrials, ...validationTrials, ...catchTrials]);

// ---------- jsPsych timeline ----------

const jsPsych = initJsPsych({
  on_finish: () => {
    document.body.innerHTML =
      '<div class="instructions" style="text-align:center;margin-top:4rem;"><h2>Thank you!</h2><p>You can close this window.</p></div>';
  },
});

const timeline = [];

timeline.push({
  type: HtmlKeyboardResponsePlugin,
  stimulus: `
    <div class="instructions">
      <h2>Word Similarity Task</h2>
      <p>On each trial you will see one word at the top and two words below it.</p>
      <p>Your job is to choose which of the two bottom words is <strong>most similar in meaning</strong> to the top word.</p>
      <p>There are no right or wrong answers for most trials — just go with your gut.</p>
      <p>The task has ${allTrials.length} trials and should take a few minutes.</p>
      <p style="margin-top:2rem;"><em>Press any key to begin.</em></p>
    </div>
  `,
});

allTrials.forEach((t, i) => {
  timeline.push({
    type: HtmlButtonResponsePlugin,
    stimulus: `
      <div class="triplet-head">${t.head}</div>
      <div class="triplet-prompt">Which is most similar in meaning?</div>
    `,
    choices: [t.left, t.right],
    button_html: (choice) => `<button class="jspsych-btn">${choice}</button>`,
    data: {
      trial_index: i,
      type: t.type,
      head: t.head,
      left: t.left,
      right: t.right,
    },
    on_finish: async (data) => {
      const winner = data.response === 0 ? t.left : t.right;
      const loser = data.response === 0 ? t.right : t.left;
      data.winner = winner;
      data.loser = loser;
      await recordTrial({
        trial_index: i,
        type: t.type,
        head: t.head,
        left: t.left,
        right: t.right,
        winner,
        loser,
        rt: data.rt,
      });
    },
  });
});

timeline.push({
  type: HtmlKeyboardResponsePlugin,
  stimulus:
    '<div class="instructions" style="text-align:center;"><h2>All done!</h2><p>Saving your responses...</p></div>',
  choices: "NO_KEYS",
  trial_duration: 1500,
  on_start: async () => {
    if (!OFFLINE_MODE) {
      try {
        await updateDoc(docRef, { completedAt: serverTimestamp() });
      } catch (err) {
        console.error("Failed to mark session complete:", err);
      }
    }
  },
});

jsPsych.run(timeline);
