// The ONLY place plan prices and limits are defined. The home page, signup page and the server all read from here.
const PLANS = {
  starter: { id: 'starter', name: 'Starter', price: 2500, tagline: 'For job seekers who search a few times a week.',
    searchesPerDay: 5, resultsPerSearch: 10, careerLinks: 2, deepReads: 0, aiLettersPerMonth: 0, trackerLimit: 100 },
  pro: { id: 'pro', name: 'Pro', price: 5000, popular: true, tagline: 'For serious job hunters who want the best matches.',
    searchesPerDay: 25, resultsPerSearch: 25, careerLinks: 8, deepReads: 10, aiLettersPerMonth: 60, trackerLimit: 2000 }
};
const planOf = (u) => PLANS[u && u.plan] || PLANS.starter;
const n = (x) => x.toLocaleString('en-US');

function benefits(p, aiOn) {
  return [
    `${p.searchesPerDay} job searches per day`,
    `Up to ${p.resultsPerSearch} ranked jobs per search`,
    p.deepReads ? `Full job-page reading for the top ${p.deepReads} results: sharper match score and keyword tips` : 'Match score on every job',
    'Resume keyword gap: see what each job wants that your resume lacks',
    aiOn && p.aiLettersPerMonth ? `${p.aiLettersPerMonth} AI-written cover letters per month, plus unlimited template letters` : 'Unlimited smart template cover letters',
    `Scan up to ${p.careerLinks} company career-page links per search`,
    `Application tracker (up to ${n(p.trackerLimit)} jobs) with follow-up reminders`,
    'Saved profile and resume, CSV export'
  ];
}
const list = (aiOn) => Object.values(PLANS).map((p) => ({ ...p, benefits: benefits(p, aiOn) }));

function plansHtml(aiOn) {
  return list(aiOn).map((p) => `<div class="plan${p.popular ? ' popular' : ''}">${p.popular ? '<span class="ribbon">Most popular</span>' : ''}
<h3>${p.name}</h3><div class="price"><small>Rs.</small>${n(p.price)}<small>/month</small></div><p class="muted">${p.tagline}</p>
<ul class="ticks">${p.benefits.map((b) => `<li>${b}</li>`).join('')}</ul>
<a class="btn ${p.popular ? 'btn-primary' : 'btn-outline'}" href="/signup?plan=${p.id}">Choose ${p.name}</a></div>`).join('');
}
module.exports = { PLANS, planOf, list, plansHtml };
