const form = document.querySelector('#createForm');
const topic = document.querySelector('#topic');
const notice = document.querySelector('#formNotice');
const count = document.querySelector('#charCount');
const rows = document.querySelector('#jobRows');
const empty = document.querySelector('#emptyState');
let jobs = [];

topic.addEventListener('input', () => { count.textContent = `${topic.value.length} / 1000`; });
document.querySelector('#filter').addEventListener('input', renderJobs);
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]); }
function renderJobs() {
  const query = document.querySelector('#filter').value.trim().toLowerCase();
  const filtered = jobs.filter(job => job.topic.toLowerCase().includes(query));
  rows.innerHTML = filtered.map(job => `<tr><td>${escapeHtml(job.topic)}</td><td>${new Date(job.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>Web Studio</td><td><span class="pill draft">${escapeHtml(job.status.toUpperCase())}</span></td></tr>`).join('');
  empty.style.display = filtered.length ? 'none' : 'flex';
  document.querySelector('#totalJobs').textContent = String(jobs.length);
}
async function loadJobs() {
  try {
    const response = await fetch('/api/jobs');
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Gagal memuat riwayat.');
    jobs = data.jobs;
    renderJobs();
  } catch { notice.textContent = 'Riwayat belum dapat dimuat. Coba refresh halaman.'; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  notice.className = 'notice';
  notice.textContent = 'Menyimpan ide…';
  try {
    const response = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: topic.value }) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Gagal menyimpan ide.');
    jobs.unshift(data.job);
    form.reset();
    count.textContent = '0 / 1000';
    notice.className = 'notice success';
    notice.textContent = `Ide tersimpan (${data.job.id.slice(0, 8)}). Pipeline AI belum aktif.`;
    renderJobs();
  } catch (error) { notice.textContent = error.message; }
  finally { button.disabled = false; }
});
loadJobs();
