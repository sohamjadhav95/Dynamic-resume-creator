let masterData = null;
let currentData = null;
let isDirty = false; // true when the user hand-edited the current resume

const DRAFT_KEY = "resume_tailor_draft_v1";

// ----------------------------------------------------
// Helpers for the inline editor
// ----------------------------------------------------
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Normalise a resume object so every part of it can be edited by path:
//  - skills become an array of {category_name, skills}
//  - list items get a stable `_key` (the filter toggles match on this, so
//    renaming a title while editing never breaks the section filters)
function prepareData(data) {
  if (data.skills && !Array.isArray(data.skills)) {
    data.skills = Object.entries(data.skills).map(([category_name, skills]) => ({ category_name, skills }));
  }
  const masterProjects = masterData ? masterData.projects.map(p => p.name) : [];
  const tag = (list, field) => (list || []).forEach(item => {
    if (!item._key) item._key = item[field];
  });
  tag(data.experience, "company");
  tag(data.research_and_open_source, "title");
  tag(data.education, "institution");
  (data.projects || []).forEach(p => {
    if (!p._key) p._key = masterProjects.includes(p.name) ? p.name : "DYNAMIC_TARGET_PROJECT";
  });
  return data;
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o == null ? o : o[k]), obj);
  if (target == null) return false;
  target[last] = value;
  return true;
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: currentData, dirty: isDirty }));
  } catch (e) { /* storage unavailable: editing still works for this session */ }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (draft && draft.data && draft.data.basics) return draft;
  } catch (e) {}
  return null;
}

function editingEnabled() {
  const cb = document.getElementById("toggle-edit-mode");
  return cb ? cb.checked : true;
}

function confirmDiscardEdits(action) {
  return !isDirty || confirm(`You have manual edits on the current resume. ${action} will discard them. Continue?`);
}

// Wraps a value in an editable span bound to a path inside currentData
function ed(path, value, placeholder) {
  const on = editingEnabled();
  return `<span class="editable" ${on ? 'contenteditable="true"' : ""} spellcheck="false" data-path="${path}" data-ph="${esc(placeholder || "")}">${esc(value)}</span>`;
}

function bulletList(listPath, bullets) {
  const on = editingEnabled();
  return `<ul class="bullet-list">
    ${bullets.map((b, bi) => `<li>${ed(`${listPath}.${bi}`, b, "Bullet text")}${on ? `<button class="bullet-del no-print" data-action="del-bullet" data-path="${listPath}" data-index="${bi}" title="Remove bullet" contenteditable="false">&times;</button>` : ""}</li>`).join("")}
  </ul>${on ? `<button class="bullet-add no-print" data-action="add-bullet" data-path="${listPath}" contenteditable="false">+ Add bullet</button>` : ""}`;
}

async function init() {
  try {
    const res = await fetch("master_resume.json");
    masterData = await res.json();
    const draft = loadDraft();
    if (draft) {
      currentData = prepareData(draft.data);
      isDirty = !!draft.dirty;
    } else {
      currentData = prepareData(clone(masterData));
    }
    generateItemToggles(masterData);
    setupInlineEditing();
    renderCurrent();
    if (draft) {
      document.getElementById("status-msg").innerText = isDirty
        ? "Restored your last edited resume. Use 'View Master Resume' to start over."
        : "Restored your last tailored resume.";
    }
  } catch (err) {
    document.getElementById("status-msg").innerText = "Error loading master_resume.json";
  }
}

function generateItemToggles(data) {
  const container = document.getElementById("item-toggles");
  let html = '';
  
  const addCategory = (title, type, list, nameField) => {
    if (list && list.length > 0) {
      html += `<div style="font-weight: 700; font-size: 0.75rem; margin-top: 8px; color: #047857; text-transform: uppercase;">${title}</div>`;
      list.forEach((item, i) => {
        html += `<label style="font-weight: normal; margin-bottom: 2px; display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: #333;">
          <input type="checkbox" id="toggle-${type}-${i}" checked onchange="renderCurrent()"> ${item[nameField]}
        </label>`;
      });
    }
  };

  addCategory('Experience', 'exp', data.experience, 'company');
  addCategory('Projects', 'proj', data.projects, 'name');
  addCategory('Research & Open Source', 'ros', data.research_and_open_source, 'title');
  addCategory('Education', 'edu', data.education, 'institution');

  container.innerHTML = html;
}

function getFilteredData(data) {
  if (!masterData || !data) return data;
  
  const filtered = JSON.parse(JSON.stringify(data));
  
  // remember each item's position so inline edits map back to currentData
  ["experience", "projects", "research_and_open_source", "education"].forEach(k => {
    if (filtered[k]) filtered[k].forEach((item, i) => { item._i = i; });
  });

  const getActiveNames = (type, list, nameField) => {
    if (!list) return [];
    return list.filter((_, i) => {
      const cb = document.getElementById(`toggle-${type}-${i}`);
      return cb ? cb.checked : true;
    }).map(item => item[nameField]);
  };

  const activeExps = getActiveNames('exp', masterData.experience, 'company');
  const activeProjs = getActiveNames('proj', masterData.projects, 'name');
  const activeROS = getActiveNames('ros', masterData.research_and_open_source, 'title');
  const activeEdus = getActiveNames('edu', masterData.education, 'institution');

  if (filtered.experience) {
    filtered.experience = filtered.experience.filter(e => activeExps.includes(e._key));
  }
  if (filtered.projects) {
    filtered.projects = filtered.projects.filter(p => {
      return activeProjs.includes(p._key);
    });
  }
  if (filtered.research_and_open_source) {
    filtered.research_and_open_source = filtered.research_and_open_source.filter(p => activeROS.includes(p._key));
  }
  if (filtered.education) {
    filtered.education = filtered.education.filter(e => activeEdus.includes(e._key));
  }
  
  return filtered;
}

function renderCurrent() {
  if (currentData) {
    renderResume(getFilteredData(currentData));
  }
}

function renderResume(data) {
  const container = document.getElementById("resume-container");
  
  const showSummary = document.getElementById("toggle-summary").checked;
  const showSkills = document.getElementById("toggle-skills").checked;
  const showExperience = document.getElementById("toggle-experience").checked;
  const showProjects = document.getElementById("toggle-projects").checked;
  const showResearchOS = document.getElementById("toggle-research-os") ? document.getElementById("toggle-research-os").checked : true;
  const showCertifications = document.getElementById("toggle-certifications").checked;
  const showEducation = document.getElementById("toggle-education").checked;

  container.classList.toggle("editing", editingEnabled());
  container.innerHTML = `
    <div class="resume-header">
      <h1>${ed("basics.name", data.basics.name, "Name")}</h1>
      <div class="contact-bar">${ed("basics.contact_line", data.basics.contact_line, "Contact line")}</div>
      <div class="badge-bar">${ed("basics.sub_badge", data.basics.sub_badge, "Badge line")}</div>
    </div>
    ${showSummary && data.summary ? `
    <div class="section">
      <div class="section-title">PROFESSIONAL SUMMARY</div>
      <p style="text-align: justify; font-size: 8.5pt;">${ed("summary", data.summary, "Summary")}</p>
    </div>` : ''}
    ${showSkills && data.skills ? `
    <div class="section">
      <div class="section-title">TECHNICAL SKILLS</div>
      <div class="skills-list">
        ${data.skills.map((item, i) => `
          <div class="skill-item"><strong>${ed(`skills.${i}.category_name`, item.category_name, "Category")}:</strong> ${ed(`skills.${i}.skills`, item.skills, "Skills")}</div>
        `).join("")}
      </div>
    </div>` : ''}
    ${showExperience && data.experience && data.experience.length > 0 ? `
    <div class="section">
      <div class="section-title">PROFESSIONAL EXPERIENCE</div>
      ${data.experience.map(exp => `
        <div class="entry">
          <div class="entry-header">
            <span class="title-left">${ed(`experience.${exp._i}.company`, exp.company, "Company")}</span>
            <span class="date-right">${ed(`experience.${exp._i}.timeline`, exp.timeline, "Timeline")}</span>
          </div>
          <div class="entry-sub">
            <span class="subtitle">${ed(`experience.${exp._i}.role`, exp.role, "Role")}</span>
          </div>
          ${bulletList(`experience.${exp._i}.bullets`, exp.bullets || [])}
        </div>
      `).join("")}
    </div>` : ''}
    ${showProjects && data.projects && data.projects.length > 0 ? `
    <div class="section">
      <div class="section-title">PROJECTS</div>
      ${data.projects.map(proj => `
        <div class="entry">
          <div class="entry-header">
            <span class="title-left">${ed(`projects.${proj._i}.name`, proj.name, "Project name")}</span>
            <span class="date-right">${ed(`projects.${proj._i}.timeline`, proj.timeline, "Timeline")}</span>
          </div>
          <div class="tech-stack"><em>${ed(`projects.${proj._i}.stack`, proj.stack, "Tech stack")}</em></div>
          ${bulletList(`projects.${proj._i}.bullets`, proj.bullets || [])}
        </div>
      `).join("")}
    </div>` : ''}
    ${showResearchOS && data.research_and_open_source && data.research_and_open_source.length > 0 ? `
    <div class="section">
      <div class="section-title">RESEARCH & OPEN SOURCE</div>
      ${data.research_and_open_source.map(ros => `
        <div class="entry">
          <div class="entry-header">
            <span class="title-left">${ed(`research_and_open_source.${ros._i}.title`, ros.title, "Title")}</span>
            <span class="date-right">${ed(`research_and_open_source.${ros._i}.timeline`, ros.timeline, "Timeline")}</span>
          </div>
          ${bulletList(`research_and_open_source.${ros._i}.bullets`, ros.bullets || [])}
        </div>
      `).join("")}
    </div>` : ''}
    ${showCertifications && data.certifications ? `
    <div class="section">
      <div class="section-title">CERTIFICATIONS & ACHIEVEMENTS</div>
      <p style="font-size: 8.5pt;">${ed("certifications", data.certifications, "Certifications")}</p>
    </div>` : ''}
    ${showEducation && data.education && data.education.length > 0 ? `
    <div class="section">
      <div class="section-title">EDUCATION</div>
      ${data.education.map(edu => `
        <div class="entry" style="margin-bottom: 2px;">
          <div class="entry-header">
            <span class="title-left">${ed(`education.${edu._i}.degree`, edu.degree, "Degree")}</span>
            <span class="date-right">${ed(`education.${edu._i}.timeline`, edu.timeline, "Timeline")}</span>
          </div>
          <div style="font-size: 8.4pt;">${ed(`education.${edu._i}.institution`, edu.institution, "Institution")}</div>
        </div>
      `).join("")}
    </div>` : ''}
    
    <div class="a4-guide no-print"></div>
  `;
}

// Inline editing: one set of delegated listeners on the resume sheet
let editStatusTimer = null;
function setupInlineEditing() {
  const container = document.getElementById("resume-container");

  container.addEventListener("input", (e) => {
    const el = e.target.closest && e.target.closest(".editable");
    if (!el || !currentData) return;
    const text = el.innerText.replace(/\s*\n+\s*/g, " ");
    if (setPath(currentData, el.dataset.path, text)) {
      isDirty = true;
      saveDraft();
      clearTimeout(editStatusTimer);
      editStatusTimer = setTimeout(() => {
        document.getElementById("status-msg").innerText = "Edits saved in this browser. Export PDF when done.";
      }, 300);
    }
  });

  // Single-line fields: Enter finishes editing instead of inserting a line break
  container.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList && e.target.classList.contains("editable")) {
      e.preventDefault();
      e.target.blur();
    }
  });

  // Always paste plain text (no foreign formatting into the resume)
  container.addEventListener("paste", (e) => {
    if (!e.target.classList || !e.target.classList.contains("editable")) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\s*\n+\s*/g, " ");
    document.execCommand("insertText", false, text);
  });

  // Add / remove bullets
  container.addEventListener("mousedown", (e) => {
    // keep focus handling from interfering with the buttons
    if (e.target.closest && e.target.closest("[data-action]")) e.preventDefault();
  });
  container.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("[data-action]");
    if (!btn || !currentData) return;
    const list = getPath(currentData, btn.dataset.path);
    if (!Array.isArray(list)) return;
    if (btn.dataset.action === "add-bullet") {
      list.push("New bullet point");
    } else if (btn.dataset.action === "del-bullet") {
      list.splice(Number(btn.dataset.index), 1);
    } else {
      return;
    }
    isDirty = true;
    saveDraft();
    renderCurrent();
  });
}

function simulateProgress() {
  const progressBar = document.getElementById("progress-bar");
  progressBar.style.background = "#10b981";
  let width = 0;
  
  const interval = setInterval(() => {
    if (width >= 90) {
      clearInterval(interval);
    } else {
      width += Math.random() * 15;
      if(width > 90) width = 90;
      progressBar.style.width = width + "%";
    }
  }, 500);
  
  return interval;
}

async function handleTailor() {
  const jd = document.getElementById("job-desc").value.trim();
  const status = document.getElementById("status-msg");
  const btn = document.getElementById("btn-tailor");
  const progressContainer = document.getElementById("progress-container");
  const progressBar = document.getElementById("progress-bar");

  if (!jd) {
    status.innerText = "Please paste a Job Description first.";
    return;
  }
  if (!confirmDiscardEdits("Tailoring again")) return;

  btn.disabled = true;
  status.innerText = "Gemini is optimizing your resume... Please wait.";
  progressContainer.style.display = "block";
  progressBar.style.width = "0%";
  
  const progressInterval = simulateProgress();

  try {
    // Send the FILTERED masterData to the API so the model only considers selected items!
    const payloadData = getFilteredData(masterData);
    
    const res = await fetch("/api/tailor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ masterData: payloadData, jobDescription: jd })
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = "Failed to tailor";
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.detail || errJson.error || "Failed to tailor";
      } catch (e) {
        errMsg = `Server Error: ${res.status}. ${errText.substring(0, 60)}...`;
      }
      throw new Error(errMsg);
    }

    const tailored = await res.json();
    
    // We update currentData with the tailored version
    currentData = clone(masterData); // reset to base
    currentData.summary = tailored.summary;
    currentData.skills = tailored.skills;
    currentData.experience = tailored.experience;
    currentData.projects = tailored.projects;
    prepareData(currentData);
    isDirty = false;
    saveDraft();
    
    renderCurrent();

    clearInterval(progressInterval);
    progressBar.style.width = "100%";
    
    setTimeout(() => {
      progressContainer.style.display = "none";
      progressBar.style.width = "0%";
    }, 1000);

    status.innerText = "Tailoring completed! Click any text in the resume to edit it, then export.";
  } catch (e) {
    clearInterval(progressInterval);
    progressBar.style.width = "100%";
    progressBar.style.background = "#ef4444";
    status.innerText = `Error: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

function resetToMaster() {
  if (!confirmDiscardEdits("Viewing the master resume")) return;
  currentData = prepareData(clone(masterData));
  isDirty = false;
  clearDraft();
  renderCurrent();
  document.getElementById("status-msg").innerText = "Viewing master resume.";
}

// Master Data Editor
function openMasterEditor() {
  const modal = document.getElementById("editor-modal");
  const editor = document.getElementById("json-editor");
  editor.value = JSON.stringify(masterData, null, 2);
  document.getElementById("editor-error").innerText = "";
  modal.style.display = "flex";
}

function closeMasterEditor() {
  document.getElementById("editor-modal").style.display = "none";
}

async function saveMasterEditor() {
  const editor = document.getElementById("json-editor");
  const errorDiv = document.getElementById("editor-error");
  
  let newData;
  try {
    newData = JSON.parse(editor.value);
  } catch (e) {
    errorDiv.style.color = "#ef4444";
    errorDiv.innerText = "Invalid JSON: " + e.message;
    return;
  }
  
  errorDiv.style.color = "#047857";
  errorDiv.innerText = "Saving to server...";
  
  try {
    const res = await fetch("/api/master", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newData)
    });
    
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Server Error: ${res.status}. ${errText.substring(0, 60)}`);
    }
    
    // Update local state and re-render
    masterData = newData;
    currentData = prepareData(clone(masterData));
    isDirty = false;
    clearDraft();
    generateItemToggles(masterData);
    renderCurrent();
    
    closeMasterEditor();
    document.getElementById("status-msg").innerText = "Master resume JSON updated and saved!";
  } catch (e) {
    errorDiv.style.color = "#ef4444";
    errorDiv.innerText = e.message;
  }
}

// ----------------------------------------------------
// ATS Analysis Report Logic
// ----------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  
  if (tabId === 'resume') {
    document.getElementById('resume-view').style.display = 'flex';
    document.getElementById('report-view').style.display = 'none';
  } else {
    document.getElementById('resume-view').style.display = 'none';
    document.getElementById('report-view').style.display = 'flex';
  }
}

async function runATSAnalysis() {
  const jobDesc = document.getElementById("job-desc").value;
  if (!jobDesc) {
    alert("Please paste a Job Description in the text box on the left first.");
    return;
  }
  
  const btn = document.getElementById("btn-run-analysis");
  const loading = document.getElementById("analysis-loading");
  const content = document.getElementById("report-content");
  
  btn.disabled = true;
  loading.style.display = "block";
  content.style.display = "none";
  
  // We send the current active text to the backend for analysis
  const resumeText = JSON.stringify(currentData, (k, v) => (k.startsWith("_") ? undefined : v));
  
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeText: resumeText, jobDescription: jobDesc })
    });
    
    if (!res.ok) {
      const errText = await res.text();
      let errMsg = "Server Error";
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.detail || errJson.error || "Failed to analyze";
      } catch(e) {
        errMsg = `Server Error: ${res.status}. ${errText.substring(0, 60)}...`;
      }
      throw new Error(errMsg);
    }
    
    const analysis = await res.json();
    renderAnalysis(analysis, jobDesc);
    content.style.display = "flex"; // Show content only on success
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    loading.style.display = "none";
  }
}

function renderAnalysis(analysis, jobDesc) {
  const tbody = document.getElementById("ats-tbody");
  tbody.innerHTML = "";
  
  if (!analysis.keywords || analysis.keywords.length === 0) {
    tbody.innerHTML = "<tr><td colspan='3'>No keywords extracted.</td></tr>";
    document.getElementById("highlighted-jd").innerText = jobDesc;
    return;
  }
  
  // Sort keywords: missing first, then by count descending
  analysis.keywords.sort((a, b) => {
    if (a.found_in_resume !== b.found_in_resume) {
      return a.found_in_resume ? 1 : -1; // missing (-1) comes before found (1)
    }
    return b.count_in_jd - a.count_in_jd;
  });
  
  // Render table
  analysis.keywords.forEach(kw => {
    const tr = document.createElement("tr");
    const statusClass = kw.found_in_resume ? "status-found" : "status-missing";
    const statusText = kw.found_in_resume ? "Found" : "Missing";
    
    tr.innerHTML = `
      <td>${kw.skill}</td>
      <td>${kw.count_in_jd}</td>
      <td><span class="status-badge ${statusClass}">${statusText}</span></td>
    `;
    tbody.appendChild(tr);
  });
  
  // Highlight JD
  // Basic implementation: escape HTML, then wrap keywords in <mark>
  let highlightedJd = jobDesc
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
    
  // Sort by length descending so longer phrases match first to prevent partial word overlap issues
  const sortedKeywords = [...analysis.keywords].sort((a, b) => b.skill.length - a.skill.length);
  
  sortedKeywords.forEach(kw => {
    // case-insensitive regex for the keyword
    // Using \b word boundaries so we don't highlight inside other words
    // We catch exceptions in case a keyword has weird regex characters
    try {
      // Escape regex specials
      const escapedSkill = kw.skill.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b(${escapedSkill})\\b`, 'gi');
      const markClass = kw.found_in_resume ? "mark-found" : "mark-missing";
      
      // We must avoid double replacing marks. 
      // A safe way for a simple prototype is to just replace. In a robust system, we'd use a real highlighter tree.
      highlightedJd = highlightedJd.replace(regex, `<mark class="${markClass}">$1</mark>`);
    } catch(e) {
      console.log("Regex error on word", kw.skill, e);
    }
  });
  
  // Fix nested marks by removing inner ones (crude fix for simple text)
  highlightedJd = highlightedJd.replace(/<mark[^>]*>((?:(?!<\/mark>).)*?)<mark[^>]*>(.*?)<\/mark>((?:(?!<\/mark>).)*?)<\/mark>/gi, '<mark class="mark-found">$1$2$3</mark>');

  document.getElementById("highlighted-jd").innerHTML = highlightedJd;
}

window.onload = init;
