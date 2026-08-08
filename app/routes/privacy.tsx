import { Prose } from "../components/Prose";

export function meta() {
  return [
    { title: "Privacy — SprueTube" },
    {
      name: "description",
      content: "What data SprueTube holds about you, why, and how to get rid of it.",
    },
  ];
}

export default function Privacy() {
  return (
    <Prose title="Privacy notice" updated="[set this date before launch]">
      <p className="st-text-muted">
        <strong>Before you publish this site:</strong> the operator's legal
        entity, registered address and ICO registration number need to go in
        below, and this notice should be read by someone qualified. It is a
        complete and honest description of what the software actually does, but
        it is not legal advice.
      </p>

      <h2>Who we are</h2>
      <p>
        SprueTube is operated by [LEGAL ENTITY], [REGISTERED ADDRESS]. For
        anything about your data, email{" "}
        <a href="mailto:privacy@spruetube.app">privacy@spruetube.app</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account.</strong> Email address, a hashed password (we
          never see the original), display name and username.
        </li>
        <li>
          <strong>Your date of birth.</strong> Collected once to check you are 13
          or over. It is never shown on your profile.
        </li>
        <li>
          <strong>What you post.</strong> Text, photos, videos, comments, likes,
          follows, saved posts.
        </li>
        <li>
          <strong>Technical data.</strong> IP address and browser user-agent
          against your login sessions, for security and abuse prevention.
        </li>
        <li>
          <strong>Reports.</strong> If you report something, we keep the report,
          what you said, and what we decided.
        </li>
      </ul>
      <p>
        We do not sell personal data and we do not run third-party tracking
        beyond the advertising described below.
      </p>

      <h2>Why we are allowed to hold it</h2>
      <ul>
        <li>
          <strong>Contract:</strong> your account and your posts — we cannot run
          the service without them.
        </li>
        <li>
          <strong>Legal obligation:</strong> the age check, and keeping
          moderation records.
        </li>
        <li>
          <strong>Legitimate interests:</strong> preventing abuse and spam, and
          keeping the site up.
        </li>
        <li>
          <strong>Consent:</strong> personalised advertising, where it applies.
          You can withdraw it at any time.
        </li>
      </ul>

      <h2>Advertising</h2>
      <p>
        Ad slots are labelled as advertisements. Where Google AdSense serves an
        ad, Google may set cookies and process data under its own privacy
        policy; you can control this at{" "}
        <a
          href="https://adssettings.google.com"
          rel="noopener"
          target="_blank"
        >
          Google Ad Settings
        </a>
        . Where we serve our own promotions, we count impressions and clicks in
        aggregate and nothing is tied to your account.
      </p>

      <h2>Who else sees your data</h2>
      <ul>
        <li>
          <strong>Cloudflare</strong> — hosting, database, image and video
          delivery. Our infrastructure provider.
        </li>
        <li>
          <strong>Google</strong> — advertising, and sign-in if you choose it.
        </li>
        <li>
          <strong>Apple</strong> — sign-in if you choose it.
        </li>
        <li>
          <strong>Law enforcement</strong> — where we are legally required, or
          where there is a serious risk to someone.
        </li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li>Account and posts: until you delete them.</li>
        <li>Deleted posts: removed from the site immediately; purged within 30 days.</li>
        <li>Login sessions: 30 days.</li>
        <li>
          Moderation records: up to 2 years, because we may need to show what we
          did and why.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Under UK GDPR you can ask for a copy of your data, correct it, delete it,
        restrict or object to how we use it, or take it elsewhere. Email{" "}
        <a href="mailto:privacy@spruetube.app">privacy@spruetube.app</a> and we
        will respond within one month.
      </p>
      <p>
        Deleting your account removes your profile, posts, comments and media.
        Moderation records about serious breaches are kept, because deleting them
        would defeat the point of having them.
      </p>
      <p>
        If we get it wrong you can complain to the Information Commissioner's
        Office at{" "}
        <a href="https://ico.org.uk" rel="noopener" target="_blank">
          ico.org.uk
        </a>
        .
      </p>

      <h2>Cookies</h2>
      <p>
        A session cookie keeps you signed in — the site does not work without it.
        Advertising cookies are only set where an ad network serves an ad, and
        only where you have agreed to it. We do not use analytics cookies.
      </p>
    </Prose>
  );
}
