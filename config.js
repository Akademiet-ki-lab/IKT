/* Helpnotes — valgfri forhåndsutfylling av Supabase-oppsettet.
 *
 * Du trenger IKKE å redigere denne filen: åpne appen og trykk «Lagring» nederst i
 * sidemenyen (eller skyikonet øverst på mobil), og lim inn URL og nøkkel der.
 *
 * Vil du heller forhåndsutfylle verdiene (f.eks. for alle PC-ene på skolen), fyll ut under.
 * Verdier lagret i appen har forrang over denne filen.
 *
 * Bruk KUN «anon»- eller «publishable»-nøkkelen. Aldri «service_role» / «secret».
 */
/* PASSORDVEGG
 * Hele systemet er låst bak et passord. Her ligger bare en hash (aldri selve passordet).
 * Bytt passord ved å lage en ny hash:
 *   node -e "console.log(require('crypto').createHash('sha256').update('helpnotes-v1:'+process.argv[1]).digest('hex'))" 'DITT-NYE-PASSORD'
 * Lim resultatet inn som passwordHash under. Tom streng ('') slår passordveggen av.
 */
window.IKT_CONFIG = {
  passwordHash: 'aee0422a11276d69b5bbfbfd3bb2db09f20cfdd285afcf0849744da9cd939af6',
  supabaseUrl: '',      // f.eks. 'https://abcdxyz.supabase.co'
  supabaseAnonKey: '',  // f.eks. 'eyJhbGciOi…' eller 'sb_publishable_…'
  requireLogin: true    // true = bare innloggede brukere har tilgang (anbefalt)
};
