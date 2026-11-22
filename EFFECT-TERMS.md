# TwoFrame community effect terms (version 1)

This is a plain-language draft, written to be read on a phone before someone sends in an effect. It is not legal advice. Have a lawyer read it before the App Store release, and fill in the legal name of whoever runs TwoFrame where it says “the maker of TwoFrame”.

The same text is shown in the app (Effect Lab, My effects, Submit). If this file changes, raise `TERMS_VERSION` in `js/tools/community.js` so new submissions record the new version.

1. **It is your own work.** You wrote this effect yourself, or you have the right to share every part of it. It has no code, presets or names taken from another app, website or person, unless their licence lets anyone reuse it in a paid product and you have named them on the @credit line.
2. **What you allow.** The effect stays yours. You give the maker of TwoFrame a free, worldwide, lasting, non-exclusive licence to include it in TwoFrame, to adjust it so it keeps working, and to offer it to every user in the free and the paid versions.
3. **No payment.** You are not paid for a submitted effect, now or later, unless a separate written agreement says so.
4. **Credit.** The creator name you type is shown with the effect.
5. **Review.** A person looks at every submission. It can be declined, edited or removed at any time. Effects that are close to one already in the library, or that copy the look of another product by name, are not accepted.
6. **Content.** No hateful, sexual or illegal content, and no names or logos of other products. An effect with strong flashing has to say so in its name or description.
7. **Taking it back.** You can ask for your effect to be removed. It is then left out of the library from the next update on. Copies people already added to their own effects stay with them.
8. **Your promise.** If someone says the effect copies theirs, answering that is your responsibility, and the effect may be removed straight away.
9. **Age.** You are 18 or older, or a parent or guardian has read this and agrees for you.
10. **Contact.** A contact you give is used only to reach you about this submission.

## How the library works

- TwoFrame has no server. The library is one file, `community.json`, next to `index.html` on the site.
- A creator saves an effect in Effect Lab, opens My effects and taps Submit. The app checks it (it compiles, it is fast enough for phones, it has its own name, and it is under 80% alike to every built-in, example and library effect). The creator types a name, agrees to these terms, and gets a file ending in `.tfx.txt` that records the agreement and its date.
- The creator posts that file on the submission page (GitHub Issues on the TwoFrame repository, which must have Issues turned on) or sends it another way.
- The owner opens Community effects, Owner tools, adds the files worth accepting, saves `community.json` and uploads it to the site. Files with no recorded agreement are refused.
- Keep every accepted `.tfx.txt` file. It is the record that the creator agreed.

## Things to decide before the store release

- Apple reviews apps that download code. Shader effects are data run by the graphics chip inside the app's own limits, but ask before relying on that. The store build can ship with the community list turned off.
- Shader sites often publish code under licences that forbid paid use. The likeness check cannot see where code came from. The reviewer should search a distinctive line of any submission before accepting it.
