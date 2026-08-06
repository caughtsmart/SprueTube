import { Link } from "react-router";
import { Prose } from "../components/Prose";

export function meta() {
  return [
    { title: "Terms — SprueTube" },
    { name: "description", content: "The terms of use for SprueTube." },
  ];
}

export default function Terms() {
  return (
    <Prose title="Terms of use" updated="[set this date before launch]">
      <p className="st-text-muted">
        <strong>Before you publish this site:</strong> fill in the operating
        entity below and have these reviewed. They are written to be accurate
        about what the software does, but they are not legal advice.
      </p>

      <h2>1. Who these are with</h2>
      <p>
        SprueTube is operated by [LEGAL ENTITY] ("we", "us"). Using the site
        means you accept these terms.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be 13 or over.</li>
        <li>One person per account. Keep your password to yourself.</li>
        <li>
          You are responsible for what is posted from your account.
        </li>
        <li>
          We can suspend or close an account that breaks the{" "}
          <Link to="/rules">community rules</Link>.
        </li>
      </ul>

      <h2>3. Your content stays yours</h2>
      <p>
        You keep every right you have in the photos, videos and text you post. To
        run the site we need permission to store and show it, so by posting you
        grant us a non-exclusive, worldwide, royalty-free licence to host,
        reproduce and display that content <strong>for the purpose of
        operating and promoting SprueTube</strong>.
      </p>
      <p>
        That licence ends when you delete the content, apart from copies already
        cached or held in backups, which age out.
      </p>
      <p>
        We will not sell your photos, license them to third parties, or use them
        in paid advertising without asking you first.
      </p>

      <h2>4. What you must not post</h2>
      <p>
        Set out in the <Link to="/rules">community rules</Link>, which form part
        of these terms. In short: nothing illegal, nothing hateful, nothing
        sexual, nothing that is not yours to post.
      </p>

      <h2>5. Moderation</h2>
      <p>
        We may remove content or restrict an account where we reasonably believe
        the rules or the law have been broken. We will tell you what happened and
        why, unless doing so would be unlawful. You can appeal to{" "}
        <a href="mailto:safety@spruetube.app">safety@spruetube.app</a>.
      </p>

      <h2>6. Advertising</h2>
      <p>
        The site carries advertising, always labelled. Some links to third-party
        shops earn us a commission. That does not change the price you pay and it
        does not affect what appears in your feed.
      </p>

      <h2>7. The service comes as it is</h2>
      <p>
        We work to keep SprueTube available and your content safe, but we cannot
        guarantee uninterrupted service and we are not liable for indirect or
        consequential loss. Keep your own copies of anything you would be upset
        to lose. Nothing here limits liability for death, personal injury or
        fraud, and none of it affects your statutory rights as a consumer.
      </p>

      <h2>8. Ending it</h2>
      <p>
        You can delete your account whenever you like from settings. We can end
        your access if you seriously or repeatedly break these terms.
      </p>

      <h2>9. Changes</h2>
      <p>
        If we change these terms in a way that matters, we will say so on the
        site before the change takes effect.
      </p>

      <h2>10. Law</h2>
      <p>
        These terms are governed by the laws of England and Wales, and its courts
        have jurisdiction.
      </p>
    </Prose>
  );
}
