/**
 * Suite de cas de figure pour vérifier les formules MasterTCO.
 * Lance : node audit-calcs.mjs
 *
 * Charge le script de index.html (sans l’interface) dans une VM Node,
 * puis enchaîne des scénarios avec résultats attendus calculés à la main.
 */
import fs from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(join(__dirname, 'index.html'), 'utf8');
const start = html.indexOf('<script>\n/* ===================== DONNÉES PAR DÉFAUT');
const mig = html.indexOf('function migrateValues(v)');
const migEnd = html.indexOf('\nfunction applyStored(', mig);
if (start < 0 || mig < 0 || migEnd < 0) throw new Error('Bloc script MasterTCO introuvable dans index.html');
/* Formules + migrateValues (sans le reste de l’UI) */
const code = html.slice(start + 8, migEnd);

const el = () => ({
  addEventListener() {},
  value: '',
  className: '',
  style: {},
  innerHTML: '',
  textContent: '',
  disabled: false,
  classList: { add() {}, remove() {}, contains() { return false; } },
  getElementsByClassName() { return []; },
  querySelector() { return null; },
  querySelectorAll() { return []; }
});
const document = {
  body: { style: {}, appendChild() {}, removeChild() {} },
  createElement() { return el(); },
  addEventListener() {},
  querySelector() { return el(); },
  querySelectorAll() { return []; },
  getElementById() { return el(); }
};
const localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};
const windowObj = { addEventListener() {}, matchMedia() { return { matches: false }; }, localStorage, html2canvas: undefined, jspdf: undefined };
const ctx = {
  console, document, window: windowObj, localStorage, navigator: {}, URL, setTimeout, Date, Math, JSON,
  parseInt, parseFloat, isNaN, isFinite, String, Number, Array, Object, Boolean, Infinity, NaN, Error
};
ctx.window = Object.assign(windowObj, ctx);
vm.createContext(ctx);
vm.runInContext(code, ctx);
ctx.buildMaps(); /* enregistre les listes déroulantes (sinon consMode etc. sont lus comme des nombres → 0) */

const almost = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;
const fails = [];
function check(name, ok, detail) {
  process.stdout.write(ok ? '.' : 'F');
  if (!ok) fails.push({ name, detail: detail === undefined ? '' : String(detail) });
}

function fresh(vExtra, onExtra) {
  /* Comme l’app : state + ons d’abord, puis readData / effOn / compute */
  Object.keys(ctx.state).forEach((k) => { delete ctx.state[k]; });
  Object.assign(ctx.state, ctx.copyDefaults(), vExtra || {});
  Object.keys(ctx.ons).forEach((k) => { delete ctx.ons[k]; });
  Object.assign(ctx.ons, ctx.copyOn(), onExtra || {});
  ctx.syncAides(ctx.state);
  const d = ctx.readData(ctx.state);
  const on = ctx.effOn();
  const r = ctx.compute(d, on);
  return { s: ctx.state, d, on, r };
}

console.log('=== MasterTCO — audit des formules ===\n');

/* ---------- 1. Batterie nette 95 % (525 → 499) ---------- */
{
  const { r } = fresh({ capBrut: '525', dod: '95' }, { batterie: true });
  check('bat nette = 525×0,95', almost(r.V.E.bat.cap, 525 * 0.95, 0.02), r.V.E.bat.cap);
  check('bat nette arrondie 499', Math.round(r.V.E.bat.cap) === 499, r.V.E.bat.cap);
}

/* ---------- 2. Migration dod 88 → 95 ---------- */
{
  const m = ctx.migrateValues({ dod: '88', dod2: '88', nom1: 'A', nom2: 'B' });
  check('mig dod 88→95', m.dod === '95', m.dod);
  check('mig dod2 88→95', m.dod2 === '95', m.dod2);
  const keep = ctx.migrateValues({ dod: '90', dod2: '92' });
  check('mig ne touche pas 90 %', keep.dod === '90', keep.dod);
}

/* ---------- 3. Migration aides : ancienne aide seule ---------- */
{
  const m = ctx.migrateValues({ aideAchat: '119522' });
  check('mig aide → autre (clés absentes)', m.aideAutre === '119522', JSON.stringify({ autre: m.aideAutre, cee: m.aideCEE }));
}
{
  const m = ctx.migrateValues({ aideAchat: '50000', aideCEE: '0', aideEDF: '0', aideAutre: '0' });
  check('mig aide → autre (lignes à 0)', m.aideAutre === '50000', m.aideAutre);
  ctx.syncAides(m);
  check('syncAides conserve 50000', almost(ctx.num(m.aideAchat), 50000, 0.01), m.aideAchat);
}
{
  const m = ctx.migrateValues({ aideAchat: '999', aideCEE: '10000', aideEDF: '0', aideAutre: '0' });
  check('mig ne casse pas CEE déjà rempli', m.aideCEE === '10000' && m.aideAutre === '0', JSON.stringify(m));
  ctx.syncAides(m);
  check('syncAides = somme lignes', almost(ctx.num(m.aideAchat), 10000, 0.01), m.aideAchat);
}

/* ---------- 4. Aides multi-lignes CEE + EDF + Autre ---------- */
{
  const { r } = fresh({
    aideCEE: '30000', aideEDF: '15000', aideAutre: '5000',
    annees: '5', modeE: 'achat', prixE: '290000'
  }, { achat: true, aides: true, borne: false });
  check('aide sum TTC', almost(r.A.E.aideT, 50000, 0.1), r.A.E.aideT);
  check('aide déduite année 1', almost(r.IT.E.aides[1], 50000, 0.1), r.IT.E.aides[1]);
}

/* ---------- 5. Aide bloquée si étude < 5 ans ---------- */
{
  const { r } = fresh({
    aideCEE: '40000', annees: '3', modeE: 'achat'
  }, { achat: true, aides: true, borne: false });
  check('aide bloquée < 5 ans', r.A.E.aideBlocked === true && almost(r.A.E.aideT, 0, 0.01), r.A.E.aideT);
}

/* ---------- 6. Conso essai électrique ---------- */
{
  const { r } = fresh({
    consMode: 'essai', km: '368,4', kwh: '319',
    saison: true, hivPct: '0', hivMois: '0', chargeDeltaT: '0'
  }, { energie: true, saison: false });
  const expect = 319 / 368.4 * 100;
  check('c100 essai', almost(r.V.E.c100, expect, 0.05), `${r.V.E.c100} vs ${expect}`);
}

/* ---------- 7. Conso réelle = essai + charge (1 kWh/100 km par t) ---------- */
{
  const { r } = fresh({
    consMode: 'essai', km: '100', kwh: '100',
    chargeDeltaT: '8', hivPct: '0', hivMois: '0'
  }, { energie: true, saison: true });
  check('cReal = 100 + 8', almost(r.V.E.cReal, 108, 0.05), r.V.E.cReal);
  check('extra100 = 8', almost(r.extra100, 8, 0.01), r.extra100);
}

/* ---------- 8. Surconsommation hiver ---------- */
{
  const { r } = fresh({
    consMode: 'direct', consDirect: '100',
    chargeDeltaT: '0', hivPct: '15', hivMois: '4'
  }, { energie: true, saison: true });
  /* cReal = (100 + 0) × (1 + 0,15 × 4/12) = 100 × 1,05 = 105 */
  check('hiver 15 % × 4/12', almost(r.V.E.cReal, 105, 0.05), r.V.E.cReal);
}

/* ---------- 9. Prix énergie HT depuis TTC ---------- */
{
  const { r, d } = fresh({
    pElec: '0,24', pElecBase: 'ttc', tvaElec: '20',
    pDiesel: '1,80', pDieselBase: 'ttc', tvaDiesel: '20',
    consMode: 'direct', consDirect: '100', cDiesel: '25',
    kmPer: '100000', kmUnit: 'an', joursAn: '250'
  }, { energie: true, saison: false, remb: false });
  check('pElec HT', almost(r.pSimpleHT, 0.24 / 1.2, 0.0001), r.pSimpleHT);
  check('pDie HT', almost(r.pDieHT, 1.8 / 1.2, 0.0001), r.pDieHT);
  const qtyE = 100000 * r.V.E.cReal / 100;
  const costE = qtyE * r.pSimpleHT;
  check('coût elec an1', almost(r.V.E.ene1, costE, 1), `${r.V.E.ene1} vs ${costE}`);
  const qtyD = 100000 * 25 / 100;
  const costD = qtyD * r.pDieHTnet;
  check('coût diesel an1', almost(r.V.D.ene1, costD, 1), `${r.V.D.ene1} vs ${costD}`);
}

/* ---------- 10. TCO = stacks − aides − recettes − revente ---------- */
{
  const { r } = fresh({}, { achat: true, aides: false, revente: true, borne: true });
  check('tcoE = stack − recettes − aides − res', almost(r.tcoE, r.stackE - r.cE.recettes - r.cE.aides - r.resE, 0.5), r.tcoE);
  check('tcoSav = tcoD − tcoE', almost(r.tcoSav, r.tcoD - r.tcoE, 0.5), r.tcoSav);
  check('cumul n avec revente = tcoE', almost(r.cumEn[r.n], r.tcoE, 1), `${r.cumEn[r.n]} vs ${r.tcoE}`);
}

/* ---------- 11. Revente % du prix ---------- */
{
  const { r } = fresh({
    modeE: 'achat', modeD: 'achat', prixE: '200000', prixD: '100000',
    resE: '30', resD: '40', resU: 'pct', annees: '5'
  }, { achat: true, revente: true, aides: false, borne: false });
  check('resE 30 %', almost(r.resE, 60000, 0.1), r.resE);
  check('resD 40 %', almost(r.resD, 40000, 0.1), r.resD);
}

/* ---------- 12. Crédit : intérêts + capital = flux ---------- */
{
  const P = 100000, taux = 5, duree = 5, n = 5;
  const mens = ctx.loanMonthly(P, taux, duree, 'ans');
  const princ = ctx.loanPrincipalByYear(P, taux, duree, 'ans', n);
  const ints = ctx.loanInterestByYear(P, taux, duree, 'ans', n);
  let sumP = 0, sumI = 0;
  for (let y = 1; y <= n; y++) { sumP += princ[y]; sumI += ints[y]; }
  check('mensualité crédit > 0', mens > 1600 && mens < 2000, mens);
  check('capital remboursé ≈ P', almost(sumP, P, 1), sumP);
  check('intérêts totaux > 0', sumI > 10000, sumI);
}

/* ---------- 13. Location : loyers = mensuel × 12 × années ---------- */
{
  const { r } = fresh({
    modeE: 'location', loyE: '4000', durLocE: '5', durLocUE: 'ans',
    aideCEE: '0', aideEDF: '0', aideAutre: '0', annees: '5',
    cbMajE: 'non'
  }, { achat: true, aides: false, borne: false, revente: false });
  check('loyers E = 4000×12×5', almost(r.cE.loyer, 4000 * 12 * 5, 1), r.cE.loyer);
}

/* ---------- 14. Location + aide client : loyer inchangé, aide déduite ---------- */
{
  const { r } = fresh({
    modeE: 'location', loyE: '4000', durLocE: '5', durLocUE: 'ans',
    aideCEE: '60000', aideCbBenef: 'client', annees: '5', cbMajE: 'non'
  }, { achat: true, aides: true, borne: false, revente: false });
  check('location : loyer non modifié par aide', almost(r.cE.loyer, 4000 * 12 * 5, 1), r.cE.loyer);
  check('location : aide client déduite', almost(r.A.E.aideDed, 60000, 0.1), r.A.E.aideDed);
}

/* ---------- 15. Location fin6 : aide HT = TTC / 1,2 ---------- */
{
  const { r } = fresh({
    modeE: 'location', loyE: '4000', durLocE: '5', durLocUE: 'ans',
    aideCEE: '60000', aideCbBenef: 'fin6', tvaLoyer: '20', annees: '5', cbMajE: 'non'
  }, { achat: true, aides: true, borne: false, revente: false });
  const ht = 60000 / 1.2;
  check('fin6 aideDed = HT', almost(r.A.E.aideDed, ht, 0.1), r.A.E.aideDed);
}

/* ---------- 16. Comparaison EE : conso véhicule 2 ---------- */
{
  const { r } = fresh({
    cmp: 'ee',
    consMode: 'direct', consDirect: '80',
    consMode2: 'direct', consDirect2: '100',
    hivPct: '0', chargeDeltaT: '0'
  }, { energie: true, saison: false });
  check('EE c100 v1', almost(r.V.E.c100, 80, 0.05), r.V.E.c100);
  check('EE c100 v2', almost(r.V.D.c100, 100, 0.05), r.V.D.c100);
}

/* ---------- 17. Comparaison DD ---------- */
{
  const { r } = fresh({
    cmp: 'dd', cDiesel1: '22', cDiesel: '28'
  }, { energie: true });
  check('DD c100 v1', almost(r.V.E.c100, 22, 0.05), r.V.E.c100);
  check('DD c100 v2', almost(r.V.D.c100, 28, 0.05), r.V.D.c100);
}

/* ---------- 18. Entretien majoré après contrat ---------- */
{
  const { r } = fresh({
    cmp: 'dd', entE: '10000', entU: 'an', entHC: 'oui', entDurE: '3', entMajE: '50',
    annees: '5'
  }, { entretien: true, evol: false });
  check('ent an3 = base', almost(r.IT.E.ent[3], 10000, 0.5), r.IT.E.ent[3]);
  check('ent an4 +50 %', almost(r.IT.E.ent[4], 15000, 0.5), r.IT.E.ent[4]);
}

/* ---------- 19. Suramortissement (info seule) ---------- */
{
  const { d, s } = fresh({
    modeE: 'achat', modeD: 'achat', prixE: '290000', prixD: '115000',
    catVeh: 'tr46', annees: '5', resE: '30', resD: '35', resU: 'pct'
  }, { suram: true, achat: true });
  /* suramCalc lit state : on l’alimente */
  Object.assign(ctx.state || (ctx.state = ctx.copyDefaults()), s);
  const S = ctx.suramCalc(d);
  check('suram ok', S && S.ok, S && S.msg);
  check('suram delta prix', almost(S.delta, 175000, 0.1), S.delta);
  check('suram taux 75 % (>16 t)', almost(S.rate, 0.75, 0.001), S.rate);
  check('suram = delta × taux', almost(S.sur, 175000 * 0.75, 0.5), S.sur);
  check('suram / an', almost(S.surYr, (175000 * 0.75) / 5, 0.5), S.surYr);
}
{
  const { d, s } = fresh({ modeE: 'location', prixE: '290000', prixD: '115000' }, { suram: true });
  Object.assign(ctx.state || (ctx.state = {}), s);
  const S = ctx.suramCalc(d);
  check('suram refusé en location simple', S && !S.ok, S && S.msg);
}

/* ---------- 20. Catégorie 16 t → taux 115 % ---------- */
{
  const { d, s } = fresh({
    modeE: 'achat', modeD: 'achat', prixE: '200000', prixD: '100000',
    catVeh: 'p16', annees: '5'
  }, { suram: true });
  Object.assign(ctx.state, s);
  const S = ctx.suramCalc(d);
  check('suram 16 t = 115 %', S && S.ok && almost(S.rate, 1.15, 0.001), S && S.rate);
}

/* ---------- 21. Borne partagée ---------- */
{
  const { r } = fresh({
    borneInv: '60000', borneNb: '3', borneAbo: '3000', borneAboU: 'an',
    aideBorne: '0', borneFin: 'comptant'
  }, { borne: true, aides: false });
  check('borne invest / camion', almost(r.borneGross, 20000, 0.1), r.borneGross);
  check('borne abo / camion', almost(r.oc.borneAbo, 1000, 0.1), r.oc.borneAbo);
}

/* ---------- 22. AdBlue thermique ---------- */
{
  const { r } = fresh({
    cmp: 'ed', cDiesel: '25', adbL: '1,5', adbU: 'l100', adbP: '0,80',
    kmPer: '100000', kmUnit: 'an'
  }, { adblue: true, energie: true });
  /* 1,5 L AdBlue / 100 km gazole → 1,5 L AdBlue pour 100 km → 1500 L/an × 0,80 */
  const expect = 100000 / 100 * 1.5 * 0.8;
  check('AdBlue an1', almost(r.V.D.adbCost, expect, 1), `${r.V.D.adbCost} vs ${expect}`);
}

/* ---------- 23. Validité des données ---------- */
{
  const bad = fresh({ kmPer: '0', kmUnit: 'an' }, {});
  check('km 0 → invalid', bad.r.valid === false, bad.r.valid);
  const ok = fresh({ kmPer: '80000', kmUnit: 'an' }, {});
  check('km OK → valid', ok.r.valid === true, ok.r.valid);
}

/* ---------- 24. Cas complet « type client » : cohérence interne ---------- */
{
  const { r } = fresh({
    cmp: 'ed', annees: '5', kmPer: '100000', kmUnit: 'an', joursAn: '220',
    consMode: 'essai', km: '368,4', kwh: '319', cDiesel: '25',
    pElec: '0,20', pElecBase: 'ttc', pDiesel: '1,80', pDieselBase: 'ttc',
    modeE: 'achat', modeD: 'achat', prixE: '290000', prixD: '115000',
    aideCEE: '40000', aideEDF: '0', aideAutre: '0',
    resE: '30', resD: '35', resU: 'pct',
    capBrut: '525', dod: '95',
    chargeDeltaT: '0', hivPct: '15', hivMois: '4'
  }, {
    energie: true, saison: true, achat: true, aides: true, revente: true,
    borne: true, entretien: true, adblue: true, assur: true, batterie: true, evol: false
  });
  check('cas client valid', r.valid === true, r.valid);
  check('cas client bat ~499', almost(r.V.E.bat.cap, 498.75, 0.1), r.V.E.bat.cap);
  check('cas client aide 40k', almost(r.A.E.aideT, 40000, 0.1), r.A.E.aideT);
  let sumPosts = 0;
  ['achat', 'loyer', 'borne', 'ene', 'ent', 'adb', 'ass', 'fin', 'batt', 'chauf', 'taxes'].forEach((k) => { sumPosts += r.cE[k]; });
  check('cas client stack = somme postes', almost(r.stackE, sumPosts, 1), `${r.stackE} vs ${sumPosts}`);
  check('cas client tco cohérent', almost(r.tcoE, r.stackE - r.cE.aides - r.cE.recettes - r.resE, 1), r.tcoE);
}

/* ---------- 25. Revente automatique (grille + km) ---------- */
{
  const { r, d } = fresh({
    resU: 'auto', annees: '5', kmPer: '100000', kmUnit: 'an',
    modeE: 'achat', modeD: 'achat', prixE: '200000', prixD: '100000',
    cmp: 'ed'
  }, { achat: true, revente: true, aides: false, borne: false });
  check('auto an5 elec 30 %', almost(ctx.resAutoPct(d, 'E'), 30, 0.05), ctx.resAutoPct(d, 'E'));
  check('auto an5 therm 38 %', almost(ctx.resAutoPct(d, 'D'), 38, 0.05), ctx.resAutoPct(d, 'D'));
  check('auto resE = 200k×30%', almost(r.resE, 60000, 0.5), r.resE);
  check('auto resD = 100k×38%', almost(r.resD, 38000, 0.5), r.resD);
}
{
  const { d } = fresh({
    resU: 'auto', annees: '5', kmPer: '120000', kmUnit: 'an',
    modeE: 'achat', modeD: 'achat', prixE: '200000', prixD: '100000'
  }, { achat: true, revente: true });
  /* +20 000 km → −2 pts */
  check('auto +20k km → elec 28 %', almost(ctx.resAutoPct(d, 'E'), 28, 0.05), ctx.resAutoPct(d, 'E'));
  check('auto +20k km → therm 36 %', almost(ctx.resAutoPct(d, 'D'), 36, 0.05), ctx.resAutoPct(d, 'D'));
}
{
  const { d } = fresh({
    resU: 'auto', annees: '5', kmPer: '80000', kmUnit: 'an',
    modeE: 'achat', modeD: 'achat', prixE: '200000', prixD: '100000'
  }, { achat: true, revente: true });
  /* −20 000 km → +2 pts */
  check('auto −20k km → elec 32 %', almost(ctx.resAutoPct(d, 'E'), 32, 0.05), ctx.resAutoPct(d, 'E'));
}
{
  const { d } = fresh({
    resU: 'auto', annees: '12', kmPer: '100000', kmUnit: 'an',
    modeE: 'achat', modeD: 'achat', prixE: '200000', prixD: '100000'
  }, { achat: true, revente: true });
  /* au-delà de 10 ans : grille année 10 */
  check('auto an12 = grille an10 elec 12 %', almost(ctx.resAutoPct(d, 'E'), 12, 0.05), ctx.resAutoPct(d, 'E'));
  check('auto an12 = grille an10 therm 16 %', almost(ctx.resAutoPct(d, 'D'), 16, 0.05), ctx.resAutoPct(d, 'D'));
}
{
  const { r } = fresh({
    resU: 'pct', resE: '25', resD: '40', annees: '5',
    modeE: 'achat', modeD: 'achat', prixE: '200000', prixD: '100000'
  }, { achat: true, revente: true });
  check('mode % manuel inchangé', almost(r.resE, 50000, 0.5) && almost(r.resD, 40000, 0.5), `${r.resE}/${r.resD}`);
}

/* ---------- 26. PDF : pages batterie présentes si électrique ---------- */
{
  const { r, d, on } = fresh({ cmp: 'ed', capBrut: '525', dod: '95' }, { batterie: true, sens: false });
  const pages = ctx.buildPages(r, d, on);
  const joined = pages.join('\n');
  check('PDF contient pile', /Batterie · pile|pile électrique|kWh nets/i.test(joined), 'pile absente');
  check('PDF contient cycles', /cycles de recharge|Niveau de charge/i.test(joined), 'cycles absents');
  check('PDF ≥ 5 pages', pages.length >= 5, pages.length);
}

console.log('\n');
if (fails.length) {
  console.log('ÉCHECS:', fails.length);
  fails.forEach((f) => console.log('-', f.name, '→', f.detail));
  process.exit(1);
}
console.log('Tous les tests OK (' + (fails.length === 0 ? 'aucun échec' : '') + ')');
