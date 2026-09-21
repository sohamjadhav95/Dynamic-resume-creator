let masterData = null;
let currentData = null;

async function init() {
  try {
    const res = await fetch("master_resume.json");
    masterData = await res.json();
    currentData = JSON.parse(JSON.stringify(masterData));
    generateItemToggles(masterData);
    renderCurrent();
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
  addCategory('Publications', 'pub', data.publications, 'title');
  addCategory('Open Source', 'os', data.open_source, 'project');
  addCategory('Education', 'edu', data.education, 'institution');

  container.innerHTML = html;
}

function getFilteredData(data) {
  if (!masterData || !data) return data;
  
  const filtered = JSON.parse(JSON.stringify(data));
  
  const getActiveNames = (type, list, nameField) => {
    if (!list) return [];
    return list.filter((_, i) => {
      const cb = document.getElementById(`toggle-${type}-${i}`);
      return cb ? cb.checked : true;
    }).map(item => item[nameField]);
  };

  const activeExps = getActiveNames('exp', masterData.experience, 'company');
  const activeProjs = getActiveNames('proj', masterData.projects, 'name');
  const activePubs = getActiveNames('pub', masterData.publications, 'title');
  const activeOS = getActiveNames('os', masterData.open_source, 'project');
  const activeEdus = getActiveNames('edu', masterData.education, 'institution');

  if (filtered.experience) {
    filtered.experience = filtered.experience.filter(e => activeExps.includes(e.company));
  }
  if (filtered.projects) {
    filtered.projects = filtered.projects.filter(p => activeProjs.includes(p.name));
  }
  if (filtered.publications) {
    filtered.publications = filtered.publications.filter(p => activePubs.includes(p.title));
  }
  if (filtered.open_source) {
    filtered.open_source = filtered.open_source.filter(o => activeOS.includes(o.project));
  }
  if (filtered.education) {
    filtered.education = filtered.education.filter(e => activeEdus.includes(e.institution));
  }
  
  return filtered;
}

function renderCurrent() {
  if (currentData) {
    renderResume(getFilteredData(currentData));
  }
}

function renderResume(data) {
  const container = document.getElementById("resume-sheet");
  
  const showSummary = document.getElementById("toggle-summary").checked;
  const showSkills = document.getElementById("toggle-skills").checked;
  const showExperience = document.getElementById("toggle-experience").checked;
  const showProjects = document.getElementById("toggle-projects").checked;
  const showPublications = document.getElementById("toggle-publications").checked;
  const showOpenSource = document.getElementById("toggle-opensource").checked;
  const showCertifications = document.getElementById("toggle-certifications").checked;
  const showEducation = document.getElementById("toggle-education").checked;

  container.innerHTML = `
    <div class="resume-header">
      <h1>${data.basics.name}</h1>
      <div class="contact-bar">${data.basics.contact_line}</div>
      <div class="badge-bar">${data.basics.sub_badge}</div>
    </div>
    ${showSummary && data.summary ? `
    <div class="section">
      <div class="section-title">PROFESSIONAL SUMMARY</div>
      <p style="text-align: justify; font-size: 8.5pt;">${data.summary}</p>
    </div>` : ''}
    ${showSkills && data.skills ? `
    <div class="section">
      <div class="section-title">TECHNICAL SKILLS</div>
      <table class="skills-table">
        <tr><td class="skill-cat">Languages</td><td>${data.skills.languages}</td></tr>
        <tr><td class="skill-cat">Generative AI</td><td>${data.skills.generative_ai}</td></tr>
        <tr><td class="skill-cat">ML/DL</td><td>${data.skills.ml_dl}</td></tr>
        <tr><td class="skill-cat">Data & Systems</td><td>${data.skills.data_systems}</td></tr>
        <tr><td class="skill-cat">Architecture</td><td>${data.skills.architecture}</td></tr>
        <tr><td class="skill-cat">Deployment & MLOps</td><td>${data.skills.deployment_mlops}</td></tr>
      </table>
    </div>` : ''}
    ${showExperience && data.experience && data.experience.length > 0 ? `
    <div class="section">
      <div class="section-title">PROFESSIONAL EXPERIENCE</div>
      ${data.experience.map(exp => `
        <div class="entry">
          <div class="entry-header">
            <span class="title-left">${exp.company}</span>
            <span class="date-right">${exp.timeline}</span>
          </div>
          <div class="entry-sub">
            <span class="subtitle">${exp.role}</span>
          </div>
          <ul class="bullet-list">
            ${exp.bullets.map(b => `<li>${b}</li>`).join("")}
          </ul>
        </div>
      `).join("")}
    </div>` : ''}
    ${showProjects && data.projects && data.projects.length > 0 ? `
    <div class="section">
      <div class="section-title">PROJECTS</div>
      ${data.projects.map(proj => `
        <div class="entry">
          <div class="entry-header">
            <span class="title-left">${proj.name}</span>
            <span class="date-right">${proj.timeline}</span>
          </div>
          <div class="tech-stack"><em>${proj.stack}</em></div>
          <ul class="bullet-list">
            ${proj.bullets.map(b => `<li>${b}</li>`).join("")}
          </ul>
        </div>
      `).join("")}
    </div>` : ''}
    ${showPublications && data.publications && data.publications.length > 0 ? `
    <div class="section">
      <div class="section-title">RESEARCH & PUBLICATIONS</div>
      ${data.publications.map(pub => `
        <div class="entry">
          <div class="entry-header">
            <span class="title-left">${pub.title}</span>
            <span class="date-right">${pub.status}</span>
          </div>
          <ul class="bullet-list">
            ${pub.bullets.map(b => `<li>${b}</li>`).join("")}
          </ul>
        </div>
      `).join("")}
    </div>` : ''}
    ${showOpenSource && data.open_source && data.open_source.length > 0 ? `
    <div class="section">
      <div class="section-title">OPEN SOURCE CONTRIBUTIONS</div>
      ${data.open_source.map(os => `
        <div class="os-item">
          <strong>${os.project}</strong> | ${os.details}
        </div>
      `).join("")}
    </div>` : ''}
    ${showCertifications && data.certifications ? `
    <div class="section">
      <div class="section-title">CERTIFICATIONS & ACHIEVEMENTS</div>
      <p style="font-size: 8.5pt;">${data.certifications}</p>
    </div>` : ''}
    ${showEducation && data.education && data.education.length > 0 ? `
    <div class="section">
      <div class="section-title">EDUCATION</div>
      ${data.education.map(edu => `
        <div class="entry" style="margin-bottom: 2px;">
          <div class="entry-header">
            <span class="title-left">${edu.degree}</span>
            <span class="date-right">${edu.timeline}</span>
          </div>
          <div style="font-size: 8.4pt;">${edu.institution}</div>
        </div>
      `).join("")}
    </div>` : ''}
    
    <div class="a4-guide no-print"></div>
  `;
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
    currentData = JSON.parse(JSON.stringify(masterData)); // reset to base
    currentData.summary = tailored.summary;
    currentData.skills = tailored.skills;
    currentData.experience = tailored.experience;
    currentData.projects = tailored.projects;
    
    renderCurrent();

    clearInterval(progressInterval);
    progressBar.style.width = "100%";
    
    setTimeout(() => {
      progressContainer.style.display = "none";
      progressBar.style.width = "0%";
    }, 1000);

    status.innerText = "Tailoring completed! Review and export.";
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
  currentData = JSON.parse(JSON.stringify(masterData));
  renderCurrent();
  document.getElementById("status-msg").innerText = "Viewing master resume.";
}

window.onload = init;
