import { Link } from "react-router";
import { Prose } from "../components/Prose";

export function meta() {
  return [
    { title: "About — SprueTube" },
    {
      name: "description",
      content:
        "SprueTube is a social network built specifically for miniature painters and model makers. Here is what it is for and how it pays for itself.",
    },
  ];
}

export default function About() {
  return (
    <Prose title="About SprueTube">
      <p>
        SprueTube is a place to post what you are actually working on. Not just
        the finished, ring-lit hero shot — the half-primed squad, the sub-assembly
        you are dreading, the third attempt at freehand that finally worked.
      </p>

      <h2>Why not just use the big platforms?</h2>
      <p>
        Because they were not built for this. A build log spread across eleven
        posts is invisible on a general-purpose feed, nobody can tell you which
        paint was used without asking in the comments, and the algorithm decides
        that miniatures are not this week's growth priority.
      </p>
      <p>SprueTube is small on purpose and specific on purpose:</p>
      <ul>
        <li>
          <strong>Projects.</strong> Group posts into one build log and the whole
          thing reads as a story from sprue to finished.
        </li>
        <li>
          <strong>Paints on the post.</strong> Tag what you used and it appears
          under the photo, permanently, for everyone who asks.
        </li>
        <li>
          <strong>Stage tags.</strong> A primed model and a finished one are
          different things and get labelled differently.
        </li>
        <li>
          <strong>A feed you control.</strong> Following is chronological. Discover
          is ranked, and the ranking is{" "}
          <a
            href="https://github.com/caughtsmart/SprueTube"
            rel="noopener"
            target="_blank"
          >
            in the open
          </a>
          .
        </li>
      </ul>

      <h2>How it pays for itself</h2>
      <p>
        Advertising, marked as advertising. Some of those adverts are for{" "}
        <a href="https://www.loadeddice.uk" rel="noopener">
          Loaded Dice
        </a>
        , the hobby shop that funds this site — and paint links on posts may earn
        it a referral. That is the whole business model. We are not selling your
        data and there is no engagement-maximising algorithm, because neither is
        how this gets paid for.
      </p>
      <p>
        SprueTube is a separate thing from the shop. You do not need to buy
        anything, ever, and nothing you post is used to advertise at you.
      </p>

      <h2>The rules, briefly</h2>
      <p>
        Be decent, credit other people's work, do not post anything illegal, and
        be 13 or over. The long version is in the{" "}
        <Link to="/rules">community rules</Link>, and if something is wrong you
        can <Link to="/safety">report it in two taps</Link>.
      </p>
    </Prose>
  );
}
