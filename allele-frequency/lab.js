"use strict";

const modes = {
  equilibrium: {
    exercise: 2, title: "Hardy–Weinberg", fitness: [1, 1, 1], size: 1000, generations: 7,
    description: "Randomly paired parents each produce two offspring that survive. Population size stays constant."
  },
  selection: {
    exercise: 3, title: "Selection against aa", fitness: [1, 1, 0], size: 1000, generations: 7,
    description: "If an offspring is aa, the same parents try again. In the first generation, aa parents can reproduce with AA or Aa partners."
  },
  advantage: {
    exercise: 4, title: "Heterozygote advantage", fitness: [0.5, 1, 0], size: 1000, generations: 7,
    description: "The same parents try again whenever an offspring fails to survive. In the first generation, aa parents can reproduce with AA or Aa partners."
  },
  drift: {
    exercise: 5, title: "Genetic drift", fitness: [1, 1, 1], size: 24, generations: 8,
    description: "Randomly split a starting population into two equal groups. Each mates only within its own group. Use the results for your assigned population."
  }
};

function shuffle(values, random, start = 0) {
  for (let i = values.length - 1; i > start; i--) {
    const j = start + Math.floor(random() * (i - start + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

// A genotype is stored as its number of a copies: 0 (AA), 1 (Aa), 2 (aa).
function founders(size) {
  return Array.from({ length: size }, (_, index) =>
    index < size / 4 ? 0 : index < 3 * size / 4 ? 1 : 2
  );
}

function parentPairs(population, excludeRecessivePairs, random) {
  if (excludeRecessivePairs) {
    // All aa parents can mate once. Assign them distinct random non-aa partners.
    const recessive = population.filter(genotype => genotype === 2);
    const partners = shuffle(population.filter(genotype => genotype !== 2), random);
    const pairs = recessive.flatMap((genotype, index) => [genotype, partners[index]]);
    return pairs.concat(partners.slice(recessive.length));
  }
  return shuffle(population.slice(), random);
}

function nextGeneration(population, fitness, firstGeneration, random) {
  const parents = parentPairs(population, firstGeneration && fitness[2] === 0, random);
  const children = [];
  for (let i = 0; i < parents.length; i += 2) {
    const left = parents[i] / 2;
    const right = parents[i + 1] / 2;
    const aa = left * right;
    const AA = (1 - left) * (1 - right);
    // Weight this pair's Mendelian probabilities by survival. Sampling from
    // these weights is equivalent to retrying with this pair until survival.
    const weightAA = AA * fitness[0];
    const weightAa = (1 - AA - aa) * fitness[1];
    const total = weightAA + weightAa + aa * fitness[2];
    for (let child = 0; child < 2; child++) {
      const draw = random() * total;
      children.push(draw < weightAA ? 0 : draw < weightAA + weightAa ? 1 : 2);
    }
  }
  return children;
}

function summarize(population, generation) {
  const counts = [0, 0, 0];
  for (const genotype of population) counts[genotype]++;
  const size = population.length;
  const A = 2 * counts[0] + counts[1];
  const a = 2 * counts[2] + counts[1];
  return {
    generation, size, counts, frequencies: counts.map(count => count / size),
    A, a, p: A / (2 * size), q: a / (2 * size)
  };
}

function simulate(mode, size, generations, random = Math.random) {
  const drift = mode === "drift";
  const initial = founders(drift ? size * 2 : size);
  const populations = drift ? [
    { name: "Population 1", founders: shuffle(initial, random).slice(0, size) },
    { name: "Population 2", founders: initial.slice(size) }
  ] : [{ name: "Population", founders: initial }];

  return populations.map(group => {
    let population = group.founders;
    const rows = [summarize(population, 0)];
    for (let generation = 1; generation <= generations; generation++) {
      population = nextGeneration(population, modes[mode].fitness, generation === 1, random);
      rows.push(summarize(population, generation));
    }
    return { name: group.name, rows };
  });
}

const byId = id => document.getElementById(id);
const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
const sizeInput = byId("size");
const generationsInput = byId("generations");
const download = byId("download");
const resultsByMode = new Map();
const settingsByMode = new Map();
const number = new Intl.NumberFormat("en-US");
const frequency = value => value.toFixed(5).replace(/0{1,4}$/, "");

let activeMode = "equilibrium";
let activeCharts = [];

const chartTypes = [
  {
    title: "Genotype frequency by generation",
    series: [["AA", row => row.frequencies[0]], ["Aa", row => row.frequencies[1]], ["aa", row => row.frequencies[2]]]
  },
  {
    title: "Allele frequency by generation",
    series: [["p (A)", row => row.p], ["q (a)", row => row.q]]
  }
];
const chartStyles = [
  { color: "#166b55", dash: [] },
  { color: "#7246ab", dash: [6, 4] },
  { color: "#a95012", dash: [2, 3] }
];

function selectMode(mode) {
  if (mode === activeMode) return;
  settingsByMode.set(activeMode, [sizeInput.value, generationsInput.value]);
  activeMode = mode;
  const config = modes[mode];
  const [size, generations] = settingsByMode.get(mode) ?? [config.size, config.generations];
  const drift = mode === "drift";

  for (const tab of tabs) {
    const selected = tab.dataset.mode === mode;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  byId("simulation").setAttribute("aria-labelledby", "tab-" + mode);
  byId("exercise-title").textContent = config.title;
  byId("exercise-description").textContent = config.description;
  byId("size-label").textContent = drift ? "Size per population" : "Population size";
  byId("size-hint").textContent = drift ? "Individuals per group, even numbers" : "Individuals, in multiples of 4";
  byId("generation-hint").textContent = mode === "equilibrium"
    ? "Adjust to match your lab" : "Worksheet default is " + config.generations;
  sizeInput.step = drift ? "2" : "4";
  sizeInput.value = size;
  generationsInput.value = generations;
  ["survival-aa-upper", "survival-hetero", "survival-aa-lower"].forEach((id, index) => {
    byId(id).textContent = config.fitness[index] * 100 + "%";
  });
  byId("start-note").textContent = drift
    ? "Before the split, the combined population is 25% AA, 50% Aa, and 25% aa. The two groups can start with different frequencies."
    : "Each run starts with 25% AA, 50% Aa, and 25% aa, so the starting p and q are both 0.5.";
  renderResults();
}

for (const tab of tabs) {
  tab.addEventListener("click", () => selectMode(tab.dataset.mode));
  tab.addEventListener("keydown", event => {
    const index = tabs.indexOf(tab);
    const next = {
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1
    };
    if (!Object.hasOwn(next, event.key)) return;
    event.preventDefault();
    const selected = tabs[next[event.key]];
    selectMode(selected.dataset.mode);
    selected.focus();
  });
}

byId("settings").addEventListener("submit", event => {
  event.preventDefault();
  const mode = activeMode;
  clearInterval(resultsByMode.get(mode)?.timer);
  const total = generationsInput.valueAsNumber;
  const run = { groups: simulate(mode, sizeInput.valueAsNumber, total), total, shown: 0 };
  resultsByMode.set(mode, run);
  renderResults();
  renderComparison();

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  byId("results-title").focus({ preventScroll: true });
  byId("results-title").closest(".result").scrollIntoView({ behavior: reduceMotion ? "instant" : "smooth" });

  run.timer = setInterval(() => {
    run.shown++;
    if (run.shown === run.total) {
      clearInterval(run.timer);
      if (mode === activeMode) renderResults();
      renderComparison();
    } else if (mode === activeMode) {
      updateProgress(run);
      drawCharts();
    }
  }, 500);
});

function table(label, captions, rows) {
  const headings = captions.map(heading => '<th scope="col">' + heading + '</th>').join("");
  const body = rows.map(([heading, ...cells]) =>
    '<tr><th scope="row">' + heading + '</th>' +
    cells.map(cell => "<td>" + cell + "</td>").join("") + "</tr>"
  ).join("");
  return '<div class="table-scroll" tabindex="0" role="region" aria-label="' + label + '"><table><caption>' +
    label + '</caption><thead><tr>' + headings + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

function dataRow(row) {
  return [
    row.generation === 0 ? "Start (0)" : "Generation " + row.generation,
    number.format(row.size),
    ...row.counts.map((count, i) => number.format(count) + " (" + frequency(row.frequencies[i]) + ")"),
    number.format(row.A), number.format(row.a), frequency(row.p), frequency(row.q)
  ];
}

function renderResults() {
  const results = byId("results");
  const run = resultsByMode.get(activeMode);
  activeCharts = [];
  download.hidden = !run || run.shown < run.total;
  byId("playback").hidden = !run || run.shown === run.total;
  if (!run) {
    results.replaceChildren();
    byId("status").textContent = "Run the simulation to see your genotype and allele counts.";
    return;
  }
  const { groups, total, shown } = run;
  const complete = shown === total;
  const { size } = groups[0].rows[0];
  const sizeDescription = groups.length === 2 ? " individuals per population." : " individuals.";
  byId("status").textContent = (complete ? "Ran " : "Simulating ") + total +
    (total === 1 ? " generation" : " generations") + " with " + number.format(size) + sizeDescription +
    (complete ? " Genotype cells show count (frequency)." : "");
  if (!complete) updateProgress(run);

  const headings = ["Generation", "Individuals", "AA", "Aa", "aa", "A copies", "a copies", "p (A)", "q (a)"];
  const charts = chartTypes.map(({ title, series }) => {
    const legend = series.map(([label]) => "<span>" + label + "</span>").join("");
    return '<figure class="chart"><figcaption>' + title + '</figcaption><div class="legend">' + legend +
      '</div><canvas role="img" aria-label="' + title + '"></canvas></figure>';
  }).join("");
  results.innerHTML = groups.map(group => {
    const heading = groups.length === 2 ? "<h3>" + group.name + "</h3>" : "";
    const graphs = '<div class="charts">' + charts + '</div>';
    const summary = [group.rows[0], group.rows.at(-1)].map(dataRow);
    const tables = complete ? table(group.name + " · Initial and final counts", headings, summary) +
      '<details><summary>View all generations</summary>' +
      table(group.name + " · All generations", headings, group.rows.map(dataRow)) + '</details>' : "";
    return '<section class="population">' + heading + graphs + tables + '</section>';
  }).join("");
  activeCharts = Array.from(results.querySelectorAll(".charts")).flatMap((charts, index) =>
    Array.from(charts.querySelectorAll("canvas"), (canvas, type) => ({
      canvas, rows: groups[index].rows, series: chartTypes[type].series
    }))
  );
  drawCharts();
}

function updateProgress({ shown, total }) {
  const progress = byId("generation-progress");
  progress.max = total;
  progress.value = shown;
  byId("generation-progress-label").textContent = "Generation " + shown + " of " + total;
}

function drawCharts() {
  const run = resultsByMode.get(activeMode);
  for (const { canvas, rows, series } of activeCharts) {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) continue;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.scale(ratio, ratio);

    const left = 37;
    const top = 12;
    const bottom = height - 27;
    const right = width - 18;
    const last = rows.length - 1;
    const x = generation => left + (right - left) * generation / last;
    const y = value => bottom - (bottom - top) * value;
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillStyle = "#465d53";
    ctx.strokeStyle = "#d1ded4";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
      ctx.fillText(String(value), left - 7, y(value));
      ctx.beginPath();
      ctx.moveTo(left, y(value));
      ctx.lineTo(right, y(value));
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const tickCount = Math.min(last, width < 400 ? 4 : 8);
    for (let tick = 0; tick <= tickCount; tick++) {
      const generation = Math.round(tick * last / tickCount);
      ctx.fillText(String(generation), x(generation), bottom + 7);
    }
    for (const [index, [, value]] of series.entries()) {
      const { color, dash } = chartStyles[index];
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(dash);
      ctx.moveTo(x(0), y(value(rows[0])));
      for (let generation = 1; generation <= run.shown; generation++) {
        ctx.lineTo(x(generation), y(value(rows[generation])));
      }
      ctx.stroke();
      if (run.shown === 0) {
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(x(0), y(value(rows[0])), 4 - index, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

window.addEventListener("resize", drawCharts);

function renderComparison() {
  const completed = Object.keys(modes).filter(key => {
    const run = resultsByMode.get(key);
    return run && run.shown === run.total;
  });
  byId("comparison").hidden = completed.length < 2;
  if (completed.length < 2) return;
  const rows = completed.flatMap(key => resultsByMode.get(key).groups.map(group => {
    const config = modes[key];
    const initial = group.rows[0];
    const final = group.rows.at(-1);
    const label = config.exercise + " · " + (key === "drift" ? group.name : config.title);
    return [label, number.format(final.size), final.generation,
      frequency(initial.p), frequency(initial.q), frequency(final.p), frequency(final.q)];
  }));
  byId("compare-table").innerHTML = table("Allele frequencies by exercise",
    ["Exercise", "Individuals", "Generations", "Initial p", "Initial q", "Final p", "Final q"], rows);
}

download.addEventListener("click", () => {
  const run = resultsByMode.get(activeMode);
  if (!run || run.shown < run.total) return;
  const headings = "Population,Generation,Individuals,Homozygous dominant (AA) count,Heterozygous (Aa) count,Homozygous recessive (aa) count,Homozygous dominant (AA) frequency,Heterozygous (Aa) frequency,Homozygous recessive (aa) frequency,Dominant allele (A) copies,Recessive allele (a) copies,p (A),q (a)";
  const lines = run.groups.flatMap(group => group.rows.map(row => [
    group.name, row.generation, row.size, ...row.counts, ...row.frequencies, row.A, row.a, row.p, row.q
  ].join(",")));
  const blob = new Blob([[headings, ...lines].join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "lab-12-exercise-" + modes[activeMode].exercise + ".csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
