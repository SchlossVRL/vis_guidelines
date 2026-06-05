import {
  initJsPsych,
  ParameterType,
} from "https://cdn.jsdelivr.net/npm/jspsych@8.0.0/+esm";
import HtmlKeyboardResponsePlugin from "https://cdn.jsdelivr.net/npm/@jspsych/plugin-html-keyboard-response@2.0.0/+esm";
import HtmlButtonResponsePlugin from "https://cdn.jsdelivr.net/npm/@jspsych/plugin-html-button-response@2.0.0/+esm";
import SurveyTextPlugin from "https://cdn.jsdelivr.net/npm/@jspsych/plugin-survey-text@2.0.0/+esm";
import HtmlSliderResponsePlugin from "https://cdn.jsdelivr.net/npm/@jspsych/plugin-html-slider-response@2.0.0/+esm";

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

const EXPERIMENT_COLLECTION = "vis-guidelines-scale-pilot-test";

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

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

// ---------- Custom consent plugin (radio + Continue button) ----------

const CONSENT_HTML = `
  <div class="consent">
    <h2>Consent to Participate in Research</h2>
    <p><strong>Study Title:</strong> Terminology Used to Describe Contributions in Visualization Research</p>
    <p><strong>Principal Investigator:</strong><br />
      Paul Rosen, Associate Professor<br />
      University of Utah<br />
      Email: paul.rosen@utah.edu</p>

    <h3>Purpose of the Study</h3>
    <p>You are invited to participate in a research study about the terminology used in visualization research papers to describe research contributions. Visualization research often uses terms such as implications, best practices, guidelines, and related phrases. This study seeks to better understand how visualization researchers use and interpret these terms.</p>

    <h3>Procedures</h3>
    <p>If you agree to participate, you will complete an online survey. The survey will ask about your familiarity with and use of terminology commonly used to describe research contributions in visualization research. The survey is expected to take approximately 20 minutes to complete.</p>

    <h3>Voluntary Participation</h3>
    <p>Your participation is completely voluntary. You may decline to participate, skip any question you do not wish to answer, or stop the survey at any time without penalty or loss of benefits.</p>

    <h3>Risks or Discomforts</h3>
    <p>The risks of participating are minimal. You may experience mild discomfort when answering some questions, fatigue from completing the survey, or concern about privacy. You may skip any question or stop participating at any time.</p>

    <h3>Benefits</h3>
    <p>You may not receive a direct personal benefit from participating. You may benefit indirectly by reflecting on how you use and interpret terminology in visualization research. The study may benefit the visualization research community by improving understanding of how terms such as implications, best practices, and guidelines are used, which may support clearer communication of research contributions.</p>

    <h3>Compensation</h3>
    <p>No compensation will be provided for participation.</p>

    <h3>Confidentiality</h3>
    <p>The researchers will make reasonable efforts to protect your privacy and confidentiality. Survey responses will be collected anonymously. Typically, group characteristics will be published, but datasets with individual responses may also be shared. In such cases, the data will not be linked to your name or other identifiable information.</p>

    <h3>Questions</h3>
    <p>If you have questions about the study, you may contact:<br />
      Paul Rosen<br />
      Associate Professor, University of Utah<br />
      paul.rosen@utah.edu</p>

    <h3>Consent</h3>
    <p>By selecting &ldquo;I agree&rdquo; and continuing to the survey, you indicate that you have read this consent information, are at least 18 years old, and voluntarily agree to participate in this research study.</p>

    <div class="consent-options">
      <label class="consent-option">
        <input type="radio" name="consent-choice" value="agree" />
        <span>I agree to participate in this study</span>
      </label>
      <label class="consent-option">
        <input type="radio" name="consent-choice" value="decline" />
        <span>I do not agree to participate in this study</span>
      </label>
    </div>

    <div class="consent-actions">
      <button class="jspsych-btn consent-continue" type="button" disabled>Continue</button>
    </div>
  </div>
`;

class ConsentPlugin {
  static info = {
    name: "consent",
    version: "1.0.0",
    parameters: {},
  };

  constructor(jsPsych) {
    this.jsPsych = jsPsych;
  }

  trial(display_element, trial) {
    display_element.innerHTML = CONSENT_HTML;

    const radios = display_element.querySelectorAll(
      'input[name="consent-choice"]',
    );
    const continueBtn = display_element.querySelector(".consent-continue");
    const start = performance.now();

    radios.forEach((r) =>
      r.addEventListener("change", () => {
        continueBtn.disabled = false;
      }),
    );

    continueBtn.addEventListener("click", () => {
      const selected = display_element.querySelector(
        'input[name="consent-choice"]:checked',
      );
      if (!selected) return;
      const consent = selected.value === "agree";
      this.jsPsych.finishTrial({
        consent,
        rt: performance.now() - start,
      });
    });
  }
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
      consent: null,
      demographics: null,
      trials: [],
    },
    { merge: true },
  );
} else {
  console.warn(
    "[OFFLINE_MODE] Firebase config is unset — trial data will be logged to console only.",
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

// ---------- balance scales -----------

const scaleOrientationMap = {};

// ---------- build trial list ----------

const stimuli = await fetch("./stimuli.json").then((r) => r.json());

const scales = shuffle(stimuli.scales);
const words = shuffle(stimuli.words);

const blocks = scales.map((scale, bIndex) => {
  const shuffledWords = shuffle(words);

  // stable key

  const scaleKey = scale.id;

  // assign once per participant

  if (scaleOrientationMap[scaleKey] === undefined) {
    scaleOrientationMap[scaleKey] = Math.random() < 0.5;
  }

  const reversed = scaleOrientationMap[scaleKey];

  // ONLY change what is shown to participant

  const displayScale = reversed
    ? {
        ...scale,
        left: scale.right,
        right: scale.left,
      }
    : scale;
  return {
    scale: displayScale,
    scale_id: scaleKey,
    reversed,
    trials: shuffledWords.map((word) => ({ word })),
  };
});

const TOTAL_BLOCKS = blocks.length;

//---------- build slider trial ----------

function makeSliderTrial(
  word,
  scale,
  blockIndex,
  trialIndex,
  reversed,
  scaleId,
) {
  return {
    type: HtmlSliderResponsePlugin,
    stimulus: `
      <div class="instructions">
        <h2>${word}</h2>
        <div class="slider-wrapper">
          <div class="slider-tick left"></div>
          <div class="slider-tick center"></div>
          <div class="slider-tick right"></div>
        </div>
      </div>
    `,
    labels: [scale.left, scale.right],
    min: -200,
    max: 200,
    step: 1,
    slider_start: 0,
    require_movement: false,
    // IMPORTANT: remove button system entirely
    //button_label: null,
    // IMPORTANT: we control trial ending ourselves
    response_ends_trial: false,
    post_trial_gap: 300,
    on_load: () => {
      setTimeout(() => {
        // REMOVE ONLY THIS TRIAL'S BUTTON

        const btn = document.querySelector(".jspsych-btn");

        if (btn) btn.style.display = "none";

        const container = document.querySelector(
          ".jspsych-html-slider-response-button",
        );

        if (container) container.style.display = "none";

        // ---- your existing slider code continues here ----

        const slider = document.querySelector(
          "#jspsych-html-slider-response-response",
        );
        if (!slider) return;
        slider.style.width = "500px";
        slider.style.maxWidth = "85vw";
        slider.style.margin = "0 auto";
        slider.style.display = "block";
        let locked = false;
        const updateSlider = (e) => {
          if (locked) return;
          const rect = slider.getBoundingClientRect();
          const percent = Math.min(
            Math.max((e.clientX - rect.left) / rect.width, 0),
            1,
          );
          const min = Number(slider.min);
          const max = Number(slider.max);
          slider.value = min + percent * (max - min);
          slider.dispatchEvent(new Event("input"));
        };
        const finishTrial = async () => {
          if (locked) return;
          locked = true;
          document.removeEventListener("mousemove", updateSlider);
          //document.removeEventListener("click", finishTrial);
          slider.removeEventListener("click", finishTrial);
          jsPsych.finishTrial({
            response: Number(slider.value),
            word,
            scale_id: scale.id,
            scale_left_display: scale.left,
            scale_right_display: scale.right,
            block: blockIndex,
            trial_index: trialIndex,
            scale_reversed: reversed,
          });
        };
        document.addEventListener("mousemove", updateSlider);
        //document.addEventListener("click", finishTrial, { once: true });
        slider.addEventListener("click", finishTrial, { once: true });
      }, 0);
    },

    on_finish: async (data) => {
      await recordTrial(data);
    },
  };
}

// Insert a break screen after each of these completed-trial counts.

/*function makeBreak(scale, blockIndex) {
  return {
    type: HtmlButtonResponsePlugin,
    stimulus: `
      <div class="instructions" style="text-align:center;">
        <p>Good work!</p>
        <p>You have completed ${blockIndex} of ${TOTAL_BLOCKS} blocks.</p>
        <hr/>
        <p>The next scale is:</p>
        <h3>${scale.left} ↔ ${scale.right}</h3>
        <p>Please click "Continue" when you are ready to start the next block.</p>
      </div>
    `,
    choices: ["Continue"],
  };
}*/
function makeBreakProgress(blockIndex) {
  return {
    type: HtmlButtonResponsePlugin,
    stimulus: `
      <div class="instructions" style="text-align:center;">
        <p>Good job! You have completed ${blockIndex} of ${TOTAL_BLOCKS} blocks.</p>
      </div>
    `,
    choices: ["Continue"],
  };
}

function makeBreakNextScale(scale) {
  return {
    type: HtmlButtonResponsePlugin,
    stimulus: `
      <div class="instructions" style="text-align:center;">
        <p>The next scale is:</p>
        <h3>${scale.left} ↔ ${scale.right}</h3>
        <p>Please click "Continue" when you are ready to start the next block.</p>
      </div>
    `,
    choices: ["Continue"],
  };
}

// ---------- jsPsych timeline ----------

const jsPsych = initJsPsych({
  on_finish: () => {
    document.body.innerHTML =
      '<div class="instructions" style="text-align:center;margin-top:4rem;"><h2>Thank you!</h2><p>Your responses have been saved. You can close this window.</p></div>';
  },
});

const timeline = [];

// Track consent in a module-level variable so conditional branches can read it.
let consented = null;

// 1. Consent screen — always shown first.
timeline.push({
  type: ConsentPlugin,
  on_finish: async (data) => {
    consented = data.consent;
    if (!OFFLINE_MODE) {
      try {
        await updateDoc(docRef, {
          consent: data.consent,
          consentedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error("Failed to save consent:", err);
      }
    }
  },
});

// 2. Decline branch — terminal screen if the participant declined.
timeline.push({
  timeline: [
    {
      type: HtmlKeyboardResponsePlugin,
      stimulus: `
        <div class="instructions" style="text-align:center;margin-top:4rem;">
          <h2>Thank you for your time</h2>
          <p>You have chosen not to participate in this study.<br />
          You may now close this window.</p>
        </div>
      `,
      choices: "NO_KEYS",
    },
  ],
  conditional_function: () => consented === false,
});

// 3. Consent-given branch — demographics, instructions, trials, completion.

timeline.push({
  timeline: [
    // ---------------- DEMOGRAPHICS ----------------
    {
      type: SurveyTextPlugin,
      preamble: `
        <div class="instructions" style="margin-bottom:1.5rem;">
          <p>Before you begin, please answer a few questions about yourself.</p>
        </div>
      `,
      questions: [
        { prompt: "Age", name: "age", rows: 1, columns: 3, required: false },
        {
          prompt: "Gender",
          name: "gender",
          rows: 1,
          columns: 15,
          required: false,
        },
        {
          prompt:
            "For how many years have you considered yourself a part of the visualization community?",
          name: "years_in_vis",
          rows: 1,
          columns: 30,
          required: false,
        },
        {
          prompt: "What do you consider to be your native language(s)?",
          name: "languages",
          rows: 6,
          columns: 60,
          required: false,
        },
      ],
      button_label: "Done",
      on_finish: async (data) => {
        const demographics = data.response || {};
        if (!OFFLINE_MODE) {
          await updateDoc(docRef, {
            demographics,
            demographicsAt: serverTimestamp(),
          });
        }
      },
    },

    // ---------------- INSTRUCTIONS ----------------

    /* {
      type: HtmlButtonResponsePlugin,
      stimulus: `
        <div class="instructions">
          <h2>Instructions</h2>
          <p>For this study, please think back to times you have read the results
          or discussion of a VIS paper and you came across words describing the
          contributions or results of the work. We will present you with words that describe contributions or results, listed below, and your task will be to rate them on a series of scales. </p>
          <p>The words you will be asked to rate are:</p>
          
          <div class="word-grid">

  ${stimuli.words.map((w) => `<div class="word-cell">${w}</div>`).join("")}

</div>
           <p>
           During the experiment you will see each word one at a time, and will be asked to rate it on each of the following scales:
           </p>
          <div class="scale-grid">

  ${blocks
    .map(
      (b) => `

    <div class="scale-cell">

      ${b.scale.left} ↔ ${b.scale.right}

    </div>

  `,
    )
    .join("")}

</div>
          <hr />
          <p>To make your rating, slide the cursor along the response scale and click the mouse to record your response.</p>
          <p>So you know what the endpoints of each scale means to you in the context of these test words, please look at the words and determine which one you associate with the left and right endpoints of each scale. When you see those words, please click near the left/right endpoints of the respective scale.</p>
          <p>If you think a word is not strongly associated with either endpoint of the scale, please click near the midpoint of the scale. Please use the full range of the scale.</p>
          <p>You will be asked to rate each word for a given scale before moving on to the next scale.</p>
          <p>Please "Next" when you are ready to proceed.</p>
        </div>
      `,
      choices: ["Next"],
    }, */

    // ---------------- SINGLE PRACTICE TRIAL ----------------

    {
      type: HtmlSliderResponsePlugin,
      stimulus: `
    
    <div class="instructions">
          <h2>Instructions</h2>
          <p>For this study, please think back to times you have read the results
          or discussion of a VIS paper and you came across words describing the
          contributions or results of the work. We will present you with words that describe contributions or results, listed below, and your task will be to rate them on a series of scales. </p>
          <p>The words you will be asked to rate are:</p>
          
          <div class="word-grid">

  ${stimuli.words.map((w) => `<div class="word-cell">${w}</div>`).join("")}

</div>
           <p>
           During the experiment you will see each word one at a time, and will be asked to rate it on each of the following scales:
           </p>
          <div class="scale-grid">

  ${blocks
    .map(
      (b) => `

    <div class="scale-cell">

      ${b.scale.left} ↔ ${b.scale.right}

    </div>

  `,
    )
    .join("")}

</div>
          <hr />
          <p>So you know what the endpoints of each scale means to you in the context of these test words, please look at the words and determine which one you associate with the left and right endpoints of each scale. When you see those words, please click near the left/right endpoints of the respective scale.</p>
          <p>If you think a word is not strongly associated with either endpoint of the scale, please click near the midpoint of the scale. Please use the full range of the scale.</p>
          <p>You will be asked to rate each word for a given scale before moving on to the next scale.</p>
        </div>
        
      <div class="instructions practice-trial">
      <p>To make your rating, slide the cursor along the response scale and click the mouse to record your response.</p>
      <p>Below in an example of what the response scale will look like. Please slide the cursor along any point of the scale and click to begin the experiment.</p>
      <div class="slider-wrapper practice-slider">
        <div class="slider-tick left"></div>
        <div class="slider-tick center"></div>
        <div class="slider-tick right"></div>
      </div>
    </div>
  `,
      labels: ["", ""],
      min: -200,
      max: 200,
      step: 1,
      slider_start: 0,
      response_ends_trial: false,
      on_load: () => {
        setTimeout(() => {
          const slider = document.querySelector(
            "#jspsych-html-slider-response-response",
          );
          if (!slider) return;
          slider.style.width = "500px";
          slider.style.maxWidth = "85vw";
          slider.style.margin = "0 auto";
          slider.style.display = "block";
          const btn = document.querySelector(".jspsych-btn");
          if (btn) btn.style.display = "none";
          const container = document.querySelector(
            ".jspsych-html-slider-response-button",
          );
          if (container) container.style.display = "none";
          let locked = false;
          const updateSlider = (e) => {
            if (locked) return;
            const rect = slider.getBoundingClientRect();
            const percent = Math.min(
              Math.max((e.clientX - rect.left) / rect.width, 0),

              1,
            );
            slider.value = -200 + percent * 400;
            slider.dispatchEvent(new Event("input"));
          };

          const finishTrial = () => {
            if (locked) return;

            locked = true;
            document.removeEventListener("mousemove", updateSlider);
            //document.removeEventListener("click", finishTrial);
            slider.removeEventListener("click", finishTrial);
            jsPsych.finishTrial({
              response: Number(slider.value),
              practice: true,
            });
          };
          document.addEventListener("mousemove", updateSlider);
          //document.addEventListener("click", finishTrial, { once: true });
          slider.addEventListener("click", finishTrial, { once: true });
        }, 0);
      },
    },

    /*// 2. Practice trial definitions

    ...[
      {
        text: "Please move the slider all the way to the <br> right endpoint of the scale",
        range: [180, 220],
      },
      {
        text: "Please move the slider all the way to the <br> left endpoint of the scale",
        range: [-220, -180],
      },
      {
        text: "Please move the slider halfway between the <br> center and right endpoint of the scale",
        range: [80, 110],
      },
      {
        text: "Please move the slider halfway between the <br> center and left endpoint of the scale",
        range: [-110, -80],
      },
    ].map((p, i) => {
      return {
        timeline: [
          // ---------------- SLIDER TRIAL ----------------

          {
            type: HtmlSliderResponsePlugin,
            stimulus: `
          <div class="instructions">
            <h2>${p.text}</h2>
            <div class="slider-wrapper">
              <div class="slider-tick left"></div>
              <div class="slider-tick center"></div>
              <div class="slider-tick right"></div>
            </div>
          </div>
        `,
            labels: ["", ""],
            min: -200,
            max: 200,
            step: 1,
            slider_start: 0,
            response_ends_trial: false,
            on_load: () => {
              setTimeout(() => {
                const slider = document.querySelector(
                  "#jspsych-html-slider-response-response",
                );
                if (!slider) return;

                // ---------------- HIDE BUTTON SAFELY ----------------

                const btn = document.querySelector(".jspsych-btn");
                if (btn) btn.style.visibility = "hidden";
                const container = document.querySelector(
                  ".jspsych-html-slider-response-button",
                );
                if (container) container.style.display = "none";
                let locked = false;
                const updateSlider = (e) => {
                  if (locked) return;
                  const rect = slider.getBoundingClientRect();
                  const percent = Math.min(
                    Math.max((e.clientX - rect.left) / rect.width, 0),
                    1,
                  );
                  const min = Number(slider.min);
                  const max = Number(slider.max);
                  slider.value = min + percent * (max - min);
                  slider.dispatchEvent(new Event("input"));
                };
                const finishTrial = () => {
                  if (locked) return;
                  locked = true;
                  document.removeEventListener("mousemove", updateSlider);
                  document.removeEventListener("click", finishTrial);
                  //MUST pass response
                  jsPsych.finishTrial({
                    response: Number(slider.value),
                  });
                };
                document.addEventListener("mousemove", updateSlider);
                document.addEventListener("click", finishTrial, { once: true });
              }, 0);
            },
            on_finish: function (data) {
              const val = data.response;
              const [low, high] = p.range;
              data.practice = true;
              data.practice_index = i;
              data.correct = val >= low && val <= high;
            },
          },

          // ---------------- FEEDBACK TRIAL ----------------

          {
            type: HtmlButtonResponsePlugin,
            stimulus: function () {
              const last = jsPsych.data.get().last(1).values()[0];
              if (last.correct) {
                return `
              <div class="instructions">
                <p><b>Good job!</b> Click "Continue" to proceed.</p>
              </div>
            `;
              } else {
                return `
              <div class="instructions">
                <p><b>Not quite!</b> The slider was not placed near the instructed location.</p>
                <p>Click "Continue" to try again.</p>
              </div>
            `;
              }
            },
            choices: ["Continue"],
          },
        ],

        // ---------------- LOOP LOGIC ----------------

        loop_function: function (data) {
          const last = data.values()[0];

          return last.correct !== true;
        },
      };
    }), */

    // ---------------- BLOCKED EXPERIMENT FLOW ----------------

    ...blocks.flatMap((block, bIndex) => {
      const blockTimeline = [];

      // break screen at start of each block

      //blockTimeline.push(makeBreak(block.scale, bIndex));
      if (bIndex > 0) {
        blockTimeline.push(makeBreakProgress(bIndex));
      }

      blockTimeline.push(makeBreakNextScale(block.scale));

      // trials
      block.trials.forEach((t, i) => {
        blockTimeline.push(
          makeSliderTrial(
            t.word,
            block.scale,
            bIndex,
            i,
            block.reversed,
            block.scale_id,
          ),
        );
      });
      return blockTimeline;
    }),

    // ---------------- COMPLETION ----------------

    {
      type: HtmlKeyboardResponsePlugin,
      stimulus: `
        <div class="instructions" style="text-align:center;">
          <h2>All done!</h2>
          <p>Saving your responses...</p>
        </div>
      `,
      choices: "NO_KEYS",
      trial_duration: 1500,
      on_start: async () => {
        if (!OFFLINE_MODE) {
          await updateDoc(docRef, { completedAt: serverTimestamp() });
        }
      },
    },
  ],
  conditional_function: () => consented === true,
});

jsPsych.run(timeline);
