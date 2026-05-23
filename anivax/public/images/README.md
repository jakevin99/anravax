# Image Assets

Drop your PNG/SVG assets here. They are served from the site root under `/images/...`.

## Expected files for the login page

| Filename            | Used for          | Recommended size |
| ------------------- | ----------------- | ---------------- |
| `cat-dog.png`       | Left illustration | 931 × 931 px     |
| `anivax-logo.png`   | Top-right logo    | 417 × 235 px     |

If a file is missing, the page falls back to a built-in SVG placeholder so the layout still renders.

## Adding new images

1. Save the file in this folder (e.g. `public/images/my-image.png`).
2. Reference it from a component as `<img src="/images/my-image.png" />`.
