dataदर्शनम् brand kit

icon.svg / favicon.svg     rounded app icon: teal tile, paper-white d, saffron pupil
icon-square.svg            full-bleed version for apple-touch and maskable icons
mark.svg                   the d and pupil alone, no tile
wordmark.svg               one-word wordmark, outlined paths
lockup.svg                 icon tile + wordmark
wordmark-ink / -paper.svg  flat-colour wordmark for light / dark backgrounds
lockup-ink / -paper.svg    flat-colour lockup for light / dark backgrounds
PNG / ICO                  icon-512, icon-192, icon-maskable-512, apple-touch-icon (180), favicon-32, favicon-16, favicon.ico

wordmark.svg, lockup.svg and mark.svg follow the OS light/dark setting when used as an image.
To inline them in JSX, delete their <style> element so they take the page text colour, or use the flat files.

Colours: teal #0b5d56, ink #13201e, paper #eef3f1, saffron #f2a900 on teal (#d98e04 on paper).
Next.js App Router: copy favicon.ico, icon.svg and apple-touch-icon.png (rename to apple-icon.png) into app/.
Pages Router: put the files in public/ and link them in your head tags.
Letterforms: Newsreader Bold (Latin) and Noto Serif Devanagari SemiBold, both SIL Open Font License 1.1, converted to outlines.
