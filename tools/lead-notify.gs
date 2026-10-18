/**
 * Turns a WeWave lead webhook into an email, using your own Gmail.
 *
 * Free, with no third-party service in the middle: Google Apps Script runs
 * this under your own account and MailApp sends through your own Gmail. The
 * only cost is a daily quota -- 100 recipients a day on a free account, which
 * is far more than this site will ever produce.
 *
 * ---------------------------------------------------------------------------
 * SETUP (about five minutes, once)
 *
 *  1. Go to  script.google.com  and click  New project.
 *  2. Delete the sample code and paste this whole file in.
 *  3. Change TO_ADDRESS below if you want it somewhere other than the Gmail
 *     you are signed in as. Change SHARED_SECRET to any random string --
 *     invent one, it just has to match what you give the Worker in step 6.
 *  4. Click  Deploy > New deployment. Choose type  Web app.
 *       Execute as:      Me
 *       Who has access:  Anyone          <-- required; Cloudflare is anonymous
 *     Click Deploy, then Authorize access and accept the Gmail permission.
 *  5. Copy the  Web app URL  it gives you. It looks like
 *       https://script.google.com/macros/s/AKfyc.../exec
 *  6. Hand that URL back with your secret on the end, exactly like this:
 *       https://script.google.com/macros/s/AKfyc.../exec?key=YOUR_SECRET
 *     That whole string is what goes in LEAD_WEBHOOK_URL.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SECRET
 *
 * A web app deployed to "Anyone" is a public URL: whoever learns it can make
 * it fire. Without a check, that is a button on the open internet that mails
 * you. The key in the query string is not real authentication -- it travels in
 * the URL -- but it is enough to stop a stray crawler, and the worst case is
 * a junk email rather than anything reaching your site or your database.
 *
 * If you ever think the URL has leaked: change SHARED_SECRET here, redeploy,
 * and give me the new URL. Nothing else needs touching.
 */

// Must be a real address, written out in full. Do NOT use
// Session.getActiveUser().getEmail() here: when a web app is deployed with
// access set to "Anyone", the caller is anonymous, so that returns an empty
// string, MailApp is handed an empty recipient and the send fails with
// nothing in the inbox to show for it. getEffectiveUser() would work, but a
// literal address is one less thing that can silently resolve to nothing.
var TO_ADDRESS   = 'aymanhesham242@gmail.com';
var SHARED_SECRET = 'change-me';    // must match ?key= on the URL you hand over


function doPost(e) {
  // Reject anything that does not carry the key, quietly.
  if (!e || !e.parameter || e.parameter.key !== SHARED_SECRET) {
    return ContentService.createTextOutput('no');
  }

  var lead = {};
  try {
    lead = JSON.parse(e.postData.contents).lead || {};
  } catch (err) {
    return ContentService.createTextOutput('bad json');
  }

  // The Worker deliberately leaves the phone number and the visitor's message
  // out of this payload -- they stay in D1 behind the admin token. That is why
  // the mail ends with a pointer to the panel rather than the full record.
  var body =
    'New meeting request\n\n' +
    'Name:      ' + (lead.name || '-') + '\n' +
    'Brand:     ' + (lead.brandLink || '-') + '\n' +
    'Services:  ' + ((lead.services || []).join(', ') || '-') + '\n' +
    'Wants to meet on: ' + (lead.meetingDate || '-') + '\n\n' +
    'Phone number and their message are in the panel:\n' +
    'https://wewave-website.aymanhesham242.workers.dev/admin\n' +
    'Reference: ' + String(lead.id || '').slice(0, 8) + '\n';

  MailApp.sendEmail({
    to: TO_ADDRESS,
    subject: 'WeWave lead - ' + (lead.name || 'new request'),
    body: body
  });

  return ContentService.createTextOutput('ok');
}


/**
 * Optional: run this once from the editor (select sendTestEmail, press Run)
 * to prove the Gmail permission works before wiring anything up.
 */
function sendTestEmail() {
  MailApp.sendEmail(TO_ADDRESS, 'WeWave lead notifier - test',
                    'If you are reading this, the notifier can send mail.');
}
