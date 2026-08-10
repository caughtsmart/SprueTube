# Compliance checklist

SprueTube hosts user-generated content, runs advertising, and is operated from
the UK. That combination carries real obligations. This file lists what the
software already does, and what still needs a decision from a person.

**This is not legal advice.** It is an honest description of what the code does,
written so that whoever does give legal advice has something accurate to work
from.

---

## Still needs a human — blocks launch

- [x] **Name the operating entity.** Set `OPERATOR.legalName` in
      `app/lib/legal.ts`. Both documents read from it, so they cannot disagree.
      For a limited company that is the registered name plus `companyNumber`;
      for a sole trader it is the trading name and `companyNumber` stays null.
      The address is prefilled from the Loaded Dice Shopify billing record —
      confirm it is the right address for service before publishing.
      While `legalName` is unset, both pages carry a visible "not reviewed yet"
      warning, which clears itself once it is filled in.
- [x] **ICO registration.** Most UK organisations processing personal data must
      register with the Information Commissioner's Office and pay the annual
      data protection fee. Put the number in `OPERATOR.icoNumber`; the privacy
      notice then states it, and omits the sentence entirely while it is null.
- [ ] **Have the privacy notice and terms reviewed.** They are complete and
      accurate about the software's behaviour, which is the hard part — but a
      solicitor should read them before launch.
- [x] **Set the "last updated" date.** `LEGAL_UPDATED` in `app/lib/legal.ts`,
      one value for both pages. Null until reviewed — a legal document carrying
      a date from before anyone read it is worse than one carrying none.
- [x] **Publish an email address — regulation 6.** The Electronic Commerce (EC
      Directive) Regulations 2002, reg. 6(1)(c), require an online service to
      publish "details of the service provider, including his electronic mail
      address, which make it possible to contact him rapidly and communicate
      with him in a direct and effective manner". In Case C-298/07 the CJEU held
      that a **web form alone does not satisfy this** — a form may be offered in
      addition, not instead. `hello@spruetube.app` is now on `/contact`,
      `/terms` and `/privacy`, defined once as `CONTACT_EMAIL` in
      `app/lib/legal.ts` and guarded by a test that fails if it is ever removed.
      A role address, so no personal address is on a page that is crawled and
      scraped, and so the person reading it can change without a deploy.
- [ ] **Point it at a human.** `hello@spruetube.app` is published on the site
      but **nothing can deliver to it**: as of 10 August 2026 `spruetube.app`
      has no MX record at all, confirmed against both Cloudflare's and Google's
      resolvers. Email Routing has not been onboarded — `cf-bounce` carries the
      Sending records but the root domain carries none of Routing's. Steps in
      `docs/DEPLOY.md` §11, rewritten for the current dashboard (Email Routing
      moved to **Compute → Email Service**, at account level) and ending with
      the one-line DNS check that would have caught this.

      This was briefly ticked off on the strength of a test that appeared to
      work. It was not re-checked against DNS, and DNS is the thing that
      decides. Outbound mail — password resets, the contact form — is a
      separate path that never touches MX, which is why it kept working and
      made the inbound side look fine.

      Until an MX exists, the address on `/terms` is exactly the dead end the
      note in `app/lib/legal.ts` warns about, and reg. 6 is not satisfied.
- [ ] **Decide who moderates, and when.** One person is enough at this size, but
      "nobody looks at the queue at weekends" is a decision you should make
      deliberately rather than discover.

## Online Safety Act (UK)

SprueTube is a user-to-user service accessible in the UK, so the Act applies
regardless of size. Small services have lighter duties, not no duties.

**Built:**

- [x] Reporting on every post, comment and profile, in two taps
- [x] Reports prioritised by severity, not arrival order — child safety, illegal
      content and threats jump the queue
- [x] Blocking (mutual invisibility, follow edges severed) and muting
- [x] Content removal and account suspension, with the user notified
- [x] Append-only audit log of every moderation decision, including dismissals
- [x] Terms that set out what is not allowed, and what happens
      (`app/routes/rules.tsx`)
- [x] A published safety page explaining how it all works and how to appeal
- [x] 13+ age gate at onboarding, date of birth stored for the check and never
      shown publicly

**Still to do:**

- [ ] **Write an illegal content risk assessment.** The Act requires one. For a
      miniature-painting site the honest answer is that most categories are low
      risk, but "low risk, here is why" written down is what compliance looks
      like. Ofcom publishes a template for small services.
- [ ] **Decide the response-time commitment** for illegal content and publish it
      on the safety page.
- [ ] Review Ofcom's codes of practice as they apply to a service this size.

## UK GDPR

**Built:**

- [x] Privacy notice covering what is collected, why, the lawful basis, who it
      is shared with, and retention
- [x] Data minimisation — no analytics tracking, no data sales, date of birth
      used only for the age check
- [x] Account deletion cascades to posts, comments, follows and media
- [x] Passwords hashed by better-auth; never stored or logged in the clear
- [x] Sessions expire after 30 days

**Still to do:**

- [ ] **A subject access request process.** The notice promises a response within
      one month. Decide who does it and how.
- [ ] **A data breach process.** Serious breaches must reach the ICO within 72
      hours. Know in advance who makes that call.
- [ ] **Cookie consent, if AdSense is enabled.** The session cookie is strictly
      necessary and needs no consent. Advertising cookies do. A consent banner
      is required *before* AdSense goes live, not after.
- [ ] Confirm Cloudflare's data processing terms cover the setup (they publish a
      standard DPA).

## Advertising

**Built:**

- [x] Every ad slot labelled "Advertisement"
- [x] Shop links carry `rel="sponsored"`; user links carry `rel="nofollow ugc"`
- [x] The About page states plainly that Loaded Dice funds the site and that
      paint links may earn a referral

**Still to do:**

- [ ] **Cookie consent before AdSense.** See above.
- [ ] Read Google's Publisher Policies once there is real content. The relevant
      risk here is UGC: an ad-serving site is responsible for the pages ads
      appear on, which is another argument for the moderation queue being kept
      clear.
- [ ] If SprueTube ever accepts paid placement directly, UK CAP rules require it
      to be identifiable as advertising — the existing label covers this, keep
      it.

## Private messaging

Direct messages change the Online Safety Act picture more than any other
feature here, because private communication is where the harms the Act is most
concerned with actually happen. The build ships with the safeguards rather than
after them:

- [x] Blocks enforced in both directions — a blocked person cannot open a
      thread, send into an existing one, or see it
- [x] Rate limiting on sending
- [x] Every message reportable, and `report.subject_type` accepts `message`
- [x] Soft delete only. A reported message still exists for a moderator to read;
      hard deletion would make every report unactionable the moment the sender
      thought better of it
- [x] Participation checked from the session on every read and write, never from
      an id in the URL

Still needed:

- [ ] **Say in the privacy notice that messages are stored, and for how long.**
      This is new personal data of a kind the notice does not yet describe, and
      it is the sort of processing people expect to be told about plainly.
- [ ] **Decide a retention period** for messages, including in deleted accounts.
      The cascade removes them with the account today, which is defensible, but
      it should be a decision rather than a side effect.
- [ ] **Decide the policy on reading reported threads.** A moderator can read a
      reported message. Say so on the safety page — people assume "private"
      means private from you too, and discovering otherwise during a dispute is
      how trust goes.

## Buying, selling and commissions

Both are **classified ads**: listings and contact, with no payment, escrow, fee
or shipping passing through SprueTube. That is a deliberate line, and it is
what keeps this a hobby site rather than an online marketplace in the legal
sense. Crossing it brings the Consumer Contracts Regulations, dispute handling,
and potentially payment-services obligations — a different business with a
different insurer.

- [x] No payments, escrow, fees or buyer protection anywhere in the code
- [x] Listings reportable, blocks respected
- [x] Plain statements on both sections that SprueTube does not handle payments
      and does not vet sellers or painters
- [x] Location is a town, not an address, and the field says so

Still needed:

- [ ] **A line in the terms** covering user-to-user trading: that agreements are
      between the two people, that SprueTube is not a party to them, and what
      happens to someone using the section to defraud people. The terms do not
      mention trading at all yet.
- [ ] **Decide the recast/counterfeit position.** Recast miniatures are a real
      and well-known problem in this hobby and Games Workshop pursue it. The
      rules should name it, and the report reasons already include
      `intellectual_property`.
- [ ] **Watch for the platform becoming a trader itself.** Loaded Dice selling
      through its own community section would change the relationship with
      buyers materially. If that is ever wanted, it needs its own advice.
- [ ] **HMRC reporting rules for digital platforms** do not bite while nothing
      is transacted here — but they would the moment money moves through the
      site. Another reason the line above is worth keeping.

## News aggregation

Every item is a summary of someone else's published article, with attribution
and a link. `source_name` and `source_url` are `NOT NULL` in the schema, so an
item that cannot say where it came from cannot be stored at all.

- [x] Attribution and an outbound link on every item
- [x] Summaries only, never reproduced articles
- [x] No images, so no third-party image licensing question

Still needed:

- [ ] **Keep summaries short.** Summarising is fine; republishing is not, and the
      line is about substance taken rather than word count.
- [ ] **Honour a publisher asking to be dropped.** Have a route for it and act
      quickly — this costs nothing and avoids the only realistic complaint.
- [ ] **Check each feed's terms** if the list grows. Most publishers offer RSS
      precisely to be summarised and linked, but not all say so.

## Before an iOS app (deferred, but the list does not change)

App Store guideline 1.2 applies to every app with user-generated content, and
review does check:

- [x] A way to filter objectionable material — sensitive-content blurring
- [x] A way to report content — on every object
- [x] A way to block abusive users
- [x] Published contact details
- [ ] **Act on reports within 24 hours.** This is a commitment about operations,
      not a feature. Review has been known to ask.
- [ ] **Sign in with Apple**, required by guideline 4.8 as soon as any other
      social login is offered. The code supports it; the secrets need setting.
- [ ] An age rating that reflects UGC — expect 12+ or 17+.
- [ ] A privacy nutrition label matching what the privacy notice actually says.

## Intellectual property

- [x] Terms make clear users keep their rights and grant only an operating
      licence — no rights grab
- [x] Recasts and pirated STL files explicitly banned in the rules
- [ ] **A takedown process** for copyright complaints. The report reason exists;
      what is missing is a documented route and a named recipient.
- [ ] Be careful with trade marks. Warhammer, Citadel, Games Workshop and the
      rest belong to their owners. Using them descriptively — "posts about
      Warhammer 40,000" — is normal and fine. Using them as branding is not.
