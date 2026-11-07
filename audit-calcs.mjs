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

/* ========== EXTENSION : scénarios critiques métier ========== */

function assertTcoIdentity(tag, r) {
  check(tag + ' tcoE = stack−aides−recettes−res', almost(r.tcoE, r.stackE - r.cE.aides - r.cE.recettes - r.resE, 0.5), r.tcoE);
  check(tag + ' tcoD = stack−aides−recettes−res', almost(r.tcoD, r.stackD - r.cD.aides - r.cD.recettes - r.resD, 0.5), r.tcoD);
  check(tag + ' tcoSav = tcoD−tcoE', almost(r.tcoSav, r.tcoD - r.tcoE, 0.5), r.tcoSav);
}

/* ---------- 27. ED : coûts énergie année 1 (référence manuelle) ---------- */
{
  const km = 100000, cE = 100, cD = 25;
  const pElecTTC = 0.24, pDieTTC = 1.80, tva = 20;
  const { r } = fresh({
    cmp: 'ed', annees: '5', kmPer: String(km), kmUnit: 'an',
    consMode: 'direct', consDirect: String(cE), cDiesel: String(cD),
    pElec: String(pElecTTC).replace('.', ','), pElecBase: 'ttc', tvaElec: String(tva),
    pDiesel: String(pDieTTC).replace('.', ','), pDieselBase: 'ttc', tvaDiesel: String(tva),
    chargeDeltaT: '0', hivPct: '0', hivMois: '0', rembOn: 'non'
  }, {
    energie: true, saison: false, contrat: false, recharge: false, remb: false,
    batterie: false, vieil: false, evol: false, achat: false, aides: false, borne: false
  });
  const pE = pElecTTC / (1 + tva / 100);
  const pD = pDieTTC / (1 + tva / 100);
  const expectE = km * cE / 100 * pE;
  const expectD = km * cD / 100 * pD;
  check('27 ED ene1 elec', almost(r.V.E.ene1, expectE, 0.5), `${r.V.E.ene1} vs ${expectE}`);
  check('27 ED ene1 therm', almost(r.V.D.ene1, expectD, 0.5), `${r.V.D.ene1} vs ${expectD}`);
  check('27 ED eco énergie an1', almost(r.an.ecoHT, expectD - expectE, 0.5), r.an.ecoHT);
  assertTcoIdentity('27 ED', r);
}

/* ---------- 28. DD : deux thermiques, coûts distincts ---------- */
{
  const km = 120000;
  const { r } = fresh({
    cmp: 'dd', annees: '5', kmPer: String(km), kmUnit: 'an',
    cDiesel1: '22', cDiesel: '30',
    pDiesel: '1,50', pDieselBase: 'ht', rembOn: 'non',
    modeE: 'achat', modeD: 'achat', prixE: '140000', prixD: '110000',
    resE: '25', resD: '30', resU: 'pct'
  }, {
    energie: true, saison: false, remb: false, evol: false,
    achat: true, revente: true, aides: false, borne: false, batterie: false,
    entretien: false, adblue: false, assur: false
  });
  check('28 DD types therm', r.V.E.type === 'therm' && r.V.D.type === 'therm', `${r.V.E.type}/${r.V.D.type}`);
  check('28 DD ene1 v1', almost(r.V.E.ene1, km * 22 / 100 * 1.5, 0.5), r.V.E.ene1);
  check('28 DD ene1 v2', almost(r.V.D.ene1, km * 30 / 100 * 1.5, 0.5), r.V.D.ene1);
  check('28 DD resE 25%', almost(r.resE, 140000 * 0.25, 0.5), r.resE);
  check('28 DD pas d’aide elec', almost(r.cE.aides, 0, 0.01) && almost(r.cD.aides, 0, 0.01), r.cE.aides);
  assertTcoIdentity('28 DD', r);
}

/* ---------- 29. EE : deux électriques, prix HT, TCO ---------- */
{
  const km = 80000;
  const { r } = fresh({
    cmp: 'ee', annees: '5', kmPer: String(km), kmUnit: 'an',
    consMode: 'direct', consDirect: '90',
    consMode2: 'direct', consDirect2: '110',
    pElec: '0,18', pElecBase: 'ht',
    chargeDeltaT: '0', hivPct: '0',
    modeE: 'achat', modeD: 'achat', prixE: '280000', prixD: '260000',
    resE: '20', resD: '22', resU: 'pct',
    aideCEE: '0', aideEDF: '0', aideAutre: '0',
    aideCEE2: '0', aideEDF2: '0', aideAutre2: '0'
  }, {
    energie: true, saison: false, contrat: false, recharge: false,
    batterie: false, vieil: false, evol: false,
    achat: true, revente: true, aides: false, borne: false,
    entretien: false, assur: false
  });
  check('29 EE types elec', r.V.E.type === 'elec' && r.V.D.type === 'elec', `${r.V.E.type}/${r.V.D.type}`);
  check('29 EE ene1 v1', almost(r.V.E.ene1, km * 90 / 100 * 0.18, 0.5), r.V.E.ene1);
  check('29 EE ene1 v2', almost(r.V.D.ene1, km * 110 / 100 * 0.18, 0.5), r.V.D.ene1);
  check('29 EE eco an1 = v2−v1', almost(r.an.ecoHT, r.V.D.ene1 - r.V.E.ene1, 0.5), r.an.ecoHT);
  assertTcoIdentity('29 EE', r);
}

/* ---------- 30. Évolution des prix dans le temps ---------- */
{
  const { r } = fresh({
    cmp: 'ed', annees: '4', kmPer: '100000', kmUnit: 'an',
    consMode: 'direct', consDirect: '100', cDiesel: '25',
    pElec: '0,20', pElecBase: 'ht', pDiesel: '1,60', pDieselBase: 'ht',
    evElec: '10', evDiesel: '5', evAutres: '0',
    chargeDeltaT: '0', hivPct: '0', rembOn: 'non'
  }, {
    energie: true, saison: false, evol: true, contrat: false, recharge: false,
    batterie: false, vieil: false, remb: false, achat: false, borne: false, aides: false
  });
  const e1 = 100000 * 100 / 100 * 0.20;
  const d1 = 100000 * 25 / 100 * 1.60;
  check('30 evol elec an1', almost(r.V.E.yr.ene[1], e1, 0.5), r.V.E.yr.ene[1]);
  check('30 evol elec an2 = ×1,10', almost(r.V.E.yr.ene[2], e1 * 1.10, 0.5), r.V.E.yr.ene[2]);
  check('30 evol elec an3 = ×1,21', almost(r.V.E.yr.ene[3], e1 * 1.10 * 1.10, 0.5), r.V.E.yr.ene[3]);
  check('30 evol die an1', almost(r.V.D.yr.ene[1], d1, 0.5), r.V.D.yr.ene[1]);
  check('30 evol die an2 = ×1,05', almost(r.V.D.yr.ene[2], d1 * 1.05, 0.5), r.V.D.yr.ene[2]);
  check('30 evol die an4 = ×1,05³', almost(r.V.D.yr.ene[4], d1 * Math.pow(1.05, 3), 0.5), r.V.D.yr.ene[4]);
}

/* ---------- 31. Contrat dépôt : sans HC → prix heures pleines ---------- */
{
  const { r } = fresh({
    cmp: 'ed', annees: '3', kmPer: '100000', kmUnit: 'an',
    consMode: 'direct', consDirect: '100',
    pHP: '0,22', pHC: '0,12', hcOn: 'non',
    kva: '0', prixKva: '0',
    chargeDeltaT: '0', hivPct: '0'
  }, {
    energie: true, contrat: true, saison: false, recharge: false,
    batterie: false, vieil: false, evol: false, achat: false, borne: false
  });
  check('31 contrat sans HC → pDep = pHP', almost(r.V.E.pDep, 0.22, 0.0001), r.V.E.pDep);
  check('31 ene1 = qty × pHP', almost(r.V.E.ene1, 100000 * 0.22, 0.5), r.V.E.ene1);
}

/* ---------- 32. Heures creuses : mix HC/HP borné entre les deux prix ---------- */
{
  const { r } = fresh({
    cmp: 'ed', annees: '3', kmPer: '80000', kmUnit: 'an', joursAn: '250',
    consMode: 'direct', consDirect: '100',
    pHP: '0,25', pHC: '0,10', hcOn: 'oui',
    hcDeb1: '22', hcFin1: '6', hRet: '18', tJour: '10',
    pilotHC: 'hc', bornePuis: '150',
    kva: '0', prixKva: '0',
    chargeDeltaT: '0', hivPct: '0',
    socFin: '100', margin: '10',
    capBrut: '525', dod: '95',
    batChim: 'manuel', batDeg: '0', batDegU: 'an'
  }, {
    energie: true, contrat: true, saison: false, recharge: false,
    batterie: true, vieil: false, evol: false, achat: false, borne: true, aides: false
  });
  const p = r.V.E.pDep;
  const sh = r.V.E.hcShare;
  check('32 HC share défini', sh !== null && sh >= 0 && sh <= 1, sh);
  check('32 pDep entre HC et HP', p >= 0.10 - 1e-9 && p <= 0.25 + 1e-9, p);
  check('32 pDep = mix share', almost(p, sh * 0.10 + (1 - sh) * 0.25, 0.0001), `${p} vs share ${sh}`);
  const qty = r.V.E.yr.qty[1];
  check('32 ene1 = qty × pDep (sans public)', almost(r.V.E.ene1, qty * p, 1), `${r.V.E.ene1} vs ${qty * p}`);
}

/* ---------- 33. Recharge immédiate (pas priorité HC) : pDep peut monter ---------- */
{
  const base = fresh({
    cmp: 'ed', annees: '3', kmPer: '80000', kmUnit: 'an', joursAn: '250',
    consMode: 'direct', consDirect: '100',
    pHP: '0,25', pHC: '0,10', hcOn: 'oui',
    hcDeb1: '22', hcFin1: '6', hRet: '18', tJour: '10',
    pilotHC: 'hc', bornePuis: '150', kva: '0', prixKva: '0',
    chargeDeltaT: '0', hivPct: '0', socFin: '100', margin: '10',
    capBrut: '525', dod: '95', batChim: 'manuel', batDeg: '0', batDegU: 'an'
  }, {
    energie: true, contrat: true, saison: false, recharge: false,
    batterie: true, vieil: false, evol: false, achat: false, borne: true
  });
  const direct = fresh({
    cmp: 'ed', annees: '3', kmPer: '80000', kmUnit: 'an', joursAn: '250',
    consMode: 'direct', consDirect: '100',
    pHP: '0,25', pHC: '0,10', hcOn: 'oui',
    hcDeb1: '22', hcFin1: '6', hRet: '18', tJour: '10',
    pilotHC: 'direct', bornePuis: '150', kva: '0', prixKva: '0',
    chargeDeltaT: '0', hivPct: '0', socFin: '100', margin: '10',
    capBrut: '525', dod: '95', batChim: 'manuel', batDeg: '0', batDegU: 'an'
  }, {
    energie: true, contrat: true, saison: false, recharge: false,
    batterie: true, vieil: false, evol: false, achat: false, borne: true
  });
  check('33 priorite HC ≤ recharge directe', base.r.V.E.pDep <= direct.r.V.E.pDep + 1e-9,
    `${base.r.V.E.pDep} vs ${direct.r.V.E.pDep}`);
}

/* ---------- 34. Achat + crédit véhicule (100 %) via compute ---------- */
{
  const prix = 200000, taux = 5, duree = 5, n = 5;
  const { r } = fresh({
    cmp: 'ed', annees: String(n),
    modeE: 'achat', modeD: 'achat', prixE: String(prix), prixD: '100000',
    finPartE: '100', finTauxE: String(taux), finDureeE: String(duree), finUE: 'ans',
    finPartD: '0',
    aideCEE: '0', aideEDF: '0', aideAutre: '0',
    resU: 'pct', resE: '0', resD: '0'
  }, {
    achat: true, fin: true, aides: false, revente: false, borne: false,
    energie: false, entretien: false, adblue: false, assur: false
  });
  let sumP = 0, sumI = 0;
  for (let y = 1; y <= n; y++) { sumP += r.IT.E.achat[y]; sumI += r.IT.E.fin[y]; }
  check('34 crédit : apport an0 = 0', almost(r.IT.E.achat[0], 0, 0.5), r.IT.E.achat[0]);
  check('34 crédit : capital total ≈ prix', almost(sumP, prix, 1), sumP);
  check('34 crédit : intérêts > 0', sumI > 20000, sumI);
  const mens = ctx.loanMonthly(prix, taux, duree, 'ans');
  check('34 crédit : intérêts ≈ n×12×mens − P', almost(sumI, n * 12 * mens - prix, 2), `${sumI} vs ${n * 12 * mens - prix}`);
  assertTcoIdentity('34 crédit', r);
}

/* ---------- 35. Crédit-bail : loyer calculé + VR en fin de contrat ---------- */
{
  const { r, d, s } = fresh({
    cmp: 'ed', annees: '5',
    modeE: 'cbail', prixE: '290000', cbTauxE: '5',
    durLocE: '5', durLocUE: 'ans',
    cbResE: '10', cbResUE: 'pct',
    cbMajE: 'non',
    aideCEE: '0', aideEDF: '0', aideAutre: '0',
    modeD: 'achat', prixD: '115000',
    resU: 'pct', resE: '20', resD: '30'
  }, {
    achat: true, fin: false, aides: false, revente: true, borne: false,
    energie: false, entretien: false, adblue: false, assur: false
  });
  const mens = ctx.creditLeaseMonthly(s, 'E');
  const vr = ctx.creditLeaseResidual(s, 'E');
  check('35 cbail mensualité > 0', mens > 0, mens);
  check('35 cbail VR = 10 %', almost(vr, 29000, 0.5), vr);
  check('35 cbail d.loyE = mens', almost(d.loyE, mens, 0.05), d.loyE);
  check('35 cbail d.optE = VR', almost(d.optE, vr, 0.05), d.optE);
  /* 5 ans × 12 loyers ; an 5 inclut la VR (option) */
  const expectLoy = mens * 12 * 5 + vr;
  check('35 cbail total loyers + VR', almost(r.cE.loyer, expectLoy, 1), `${r.cE.loyer} vs ${expectLoy}`);
  check('35 cbail propriétaire en fin → revente', r.ownE === true && r.resE > 0, `${r.ownE}/${r.resE}`);
  assertTcoIdentity('35 cbail', r);
}

/* ---------- 36. Location simple : pas de revente (pas propriétaire) ---------- */
{
  const { r } = fresh({
    cmp: 'ed', annees: '5',
    modeE: 'location', loyE: '4500', durLocE: '5', durLocUE: 'ans', cbMajE: 'non',
    modeD: 'achat', prixD: '115000',
    resU: 'pct', resE: '40', resD: '35'
  }, { achat: true, revente: true, aides: false, borne: false, energie: false });
  check('36 location : pas propriétaire E', r.ownE === false, r.ownE);
  check('36 location : resE = 0', almost(r.resE, 0, 0.01), r.resE);
  check('36 achat D : resD > 0', r.ownD === true && almost(r.resD, 115000 * 0.35, 0.5), r.resD);
}

/* ---------- 37. Revente en € HT ---------- */
{
  const { r } = fresh({
    cmp: 'ed', annees: '5',
    modeE: 'achat', modeD: 'achat', prixE: '290000', prixD: '115000',
    resU: 'eur', resE: '87000', resD: '40000'
  }, { achat: true, revente: true, aides: false, borne: false, energie: false });
  check('37 res € E', almost(r.resE, 87000, 0.1), r.resE);
  check('37 res € D', almost(r.resD, 40000, 0.1), r.resD);
}

/* ---------- 38. Borne à crédit : capital + intérêts ---------- */
{
  const inv = 60000, taux = 4, duree = 5, n = 5, nb = 2;
  const { r } = fresh({
    cmp: 'ed', annees: String(n),
    borneInv: String(inv), borneNb: String(nb), borneFin: 'credit',
    borneTaux: String(taux), borneDuree: String(duree),
    borneAbo: '0', aideBorne: '0'
  }, {
    borne: true, aides: false, achat: false, energie: false,
    entretien: false, adblue: false, assur: false, revente: false
  });
  const share = inv / nb;
  check('38 borne loan / camion', almost(r.borneLoan, share, 0.1), r.borneLoan);
  check('38 borne an0 comptant = 0', almost(r.IT.E.borne[0], 0, 0.5), r.IT.E.borne[0]);
  let sumP = 0, sumI = 0;
  for (let y = 1; y <= n; y++) {
    sumP += r.IT.E.borne[y]; /* abo=0 → borne[y] = principal année */
    sumI += r.IT.E.fin[y];
  }
  check('38 borne capital ≈ share', almost(sumP, share, 1), sumP);
  check('38 borne intérêts > 0', sumI > 2000, sumI);
}

/* ---------- 39. Mixed financement E location / D achat + évolution autres ---------- */
{
  const { r } = fresh({
    cmp: 'ed', annees: '3',
    modeE: 'location', loyE: '5000', durLocE: '3', durLocUE: 'ans', cbMajE: 'non',
    modeD: 'achat', prixD: '120000',
    entE: '8000', entD: '9000', entU: 'an',
    assE: '4000', assD: '3500', assU: 'an',
    evAutres: '10', evElec: '0', evDiesel: '0'
  }, {
    achat: true, revente: false, aides: false, borne: false,
    energie: false, entretien: true, assur: true, adblue: false, evol: true
  });
  check('39 loyers E = 5000×36', almost(r.cE.loyer, 5000 * 12 * 3, 1), r.cE.loyer);
  check('39 ent E an1', almost(r.IT.E.ent[1], 8000, 0.5), r.IT.E.ent[1]);
  check('39 ent E an2 ×1,10', almost(r.IT.E.ent[2], 8000 * 1.1, 0.5), r.IT.E.ent[2]);
  check('39 ass D an3 ×1,21', almost(r.IT.D.ass[3], 3500 * 1.1 * 1.1, 0.5), r.IT.D.ass[3]);
  assertTcoIdentity('39 mixed', r);
}

/* ---------- 40. Scénario prudent : chocs scElec / scDiesel ---------- */
{
  const base = fresh({
    cmp: 'ed', annees: '3', kmPer: '100000', kmUnit: 'an',
    consMode: 'direct', consDirect: '100', cDiesel: '25',
    pElec: '0,20', pElecBase: 'ht', pDiesel: '1,60', pDieselBase: 'ht',
    scElec: '10', scDiesel: '-10', scKm: '0', scRes: '0',
    chargeDeltaT: '0', hivPct: '0', rembOn: 'non'
  }, {
    energie: true, saison: false, evol: false, contrat: false, recharge: false,
    batterie: false, remb: false, achat: false, borne: false
  });
  const p = ctx.prudentData(base.d);
  check('40 prudent pElec +10 %', almost(p.pElec, 0.22, 0.0001), p.pElec);
  check('40 prudent pDiesel −10 %', almost(p.pDiesel, 1.44, 0.0001), p.pDiesel);
  const rp = ctx.compute(p, base.on);
  check('40 prudent ene elec ↑', rp.V.E.ene1 > base.r.V.E.ene1 * 1.05, `${rp.V.E.ene1} vs ${base.r.V.E.ene1}`);
  check('40 prudent ene die ↓', rp.V.D.ene1 < base.r.V.D.ene1 * 0.95, `${rp.V.D.ene1} vs ${base.r.V.D.ene1}`);
}

/* ---------- 41. kmUnit ≠ an ---------- */
{
  const { r } = fresh({
    kmPer: '400', kmUnit: 'jour', kmNb: '220',
    consMode: 'direct', consDirect: '100',
    pElec: '0,20', pElecBase: 'ht', chargeDeltaT: '0', hivPct: '0'
  }, { energie: true, saison: false, batterie: false, evol: false, contrat: false, recharge: false, achat: false, borne: false });
  check('41 kmAn = 400×220', almost(r.kmAn, 88000, 0.1), r.kmAn);
  check('41 ene1 cohérent', almost(r.V.E.ene1, 88000 * 100 / 100 * 0.20, 0.5), r.V.E.ene1);
}

/* ---------- 42. TICPE remboursée : net diesel ---------- */
{
  const { r } = fresh({
    cmp: 'ed', annees: '3', kmPer: '100000', kmUnit: 'an',
    cDiesel: '25', pDiesel: '1,60', pDieselBase: 'ht',
    rembOn: 'oui', rembTicpe: '0,20',
    consMode: 'direct', consDirect: '100', pElec: '0,20', pElecBase: 'ht',
    chargeDeltaT: '0', hivPct: '0'
  }, {
    energie: true, remb: true, saison: false, evol: false,
    batterie: false, contrat: false, recharge: false, achat: false, borne: false
  });
  check('42 pDieHTnet = 1,40', almost(r.pDieHTnet, 1.40, 0.0001), r.pDieHTnet);
  check('42 ene die avec remb', almost(r.V.D.ene1, 100000 * 25 / 100 * 1.40, 0.5), r.V.D.ene1);
}

/* ---------- 43. Cumul énergie = somme années (avec évolution) ---------- */
{
  const { r } = fresh({
    cmp: 'ee', annees: '4', kmPer: '100000', kmUnit: 'an',
    consMode: 'direct', consDirect: '100',
    consMode2: 'direct', consDirect2: '100',
    pElec: '0,15', pElecBase: 'ht', evElec: '8',
    chargeDeltaT: '0', hivPct: '0'
  }, {
    energie: true, saison: false, evol: true, contrat: false, recharge: false,
    batterie: false, vieil: false, achat: false, borne: false
  });
  let sum = 0;
  for (let y = 1; y <= 4; y++) { sum += r.V.E.yr.ene[y]; }
  check('43 cumEneE = somme ene', almost(r.cumEneE[4], sum, 0.5), `${r.cumEneE[4]} vs ${sum}`);
  check('43 EE mêmes conso → eco énergie ~0', almost(r.totEneHT, 0, 0.5), r.totEneHT);
}

/* ---------- 44. Cas stress ED complet (financements croisés) ---------- */
{
  const { r } = fresh({
    cmp: 'ed', annees: '8', kmPer: '130000', kmUnit: 'an', joursAn: '250',
    consMode: 'essai', km: '400', kwh: '360', cDiesel: '27',
    pElec: '0,22', pElecBase: 'ttc', tvaElec: '20',
    pDiesel: '1,75', pDieselBase: 'ttc', tvaDiesel: '20',
    modeE: 'cbail', prixE: '310000', cbTauxE: '4,5',
    durLocE: '6', durLocUE: 'ans', cbResE: '15', cbResUE: 'pct', cbMajE: 'non',
    modeD: 'achat', prixD: '125000',
    finPartD: '70', finTauxD: '4', finDureeD: '6', finUD: 'ans',
    aideCEE: '35000', aideEDF: '10000', aideAutre: '0',
    aideCbBenef: 'client',
    resU: 'auto',
    evElec: '3', evDiesel: '2', evAutres: '1',
    chargeDeltaT: '5', hivPct: '12', hivMois: '4',
    capBrut: '525', dod: '95',
    borneInv: '45000', borneNb: '1', borneFin: 'comptant', borneAbo: '2400', borneAboU: 'an'
  }, {
    energie: true, saison: true, evol: true, contrat: false, recharge: false,
    achat: true, fin: true, aides: true, revente: true, borne: true,
    entretien: true, adblue: true, assur: true, batterie: true, vieil: true
  });
  check('44 stress valid', r.valid === true, r.valid);
  check('44 stress cbail E', r.d.modeE === 'cbail' && r.cE.loyer > 0, r.cE.loyer);
  check('44 stress achat+crédit D', r.A.D.loanP > 0 && r.cD.fin > 0, `${r.A.D.loanP}/${r.cD.fin}`);
  check('44 stress aide E 45k', almost(r.A.E.aideT, 45000, 0.5), r.A.E.aideT);
  check('44 stress auto res > 0 si own', (r.ownE ? r.resE > 0 : r.resE === 0), `${r.ownE}/${r.resE}`);
  assertTcoIdentity('44 stress', r);
  /* Cumul final avec revente = TCO */
  check('44 stress cumEn[n]=tcoE', almost(r.cumEn[r.n], r.tcoE, 1), `${r.cumEn[r.n]} vs ${r.tcoE}`);
  check('44 stress cumDn[n]=tcoD', almost(r.cumDn[r.n], r.tcoD, 1), `${r.cumDn[r.n]} vs ${r.tcoD}`);
}

console.log('\n');
if (fails.length) {
  console.log('ÉCHECS:', fails.length);
  fails.forEach((f) => console.log('-', f.name, '→', f.detail));
  process.exit(1);
}
const passHint = fails.length === 0 ? 'aucun échec' : '';
console.log('Tous les tests OK (' + passHint + ')');
