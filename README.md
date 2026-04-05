# WebP Compression Attachment Component

A Svelte component for Budibase that automatically converts image attachments to [WebP](https://developers.google.com/speed/webp) format **before upload**, reducing storage costs and improving load times.

## Features

- **Automatic Conversion**: Converts JPG, PNG, GIF, and BMP images to WebP on upload
- **Quality Control**: Configurable compression quality (default: 85%)
- **Smart Skipping**: Skips small files below `minSizeToCompress` threshold (default: 500KB) to save processing time
- **Resizing Support**: Automatically resizes oversized images to `maxWidth` × `maxHeight` limits
- **Photo Annotation**: Optional editor overlay allowing arrows on single images before upload

## Component Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `field` | object | — | Budibase field configuration |
| `label` | string | "Attachments" | Field label text |
| `disabled` | boolean | false | Disable uploads |
| `compact` | boolean | false | Compact vertical layout |
| `extensions` | string | `*` | Accepted file extensions filter |
| `onChange` | function | — | Change handler callback |
| `maximum` | number | 1 | Max files allowed (1 = single) |
| `helpText` | string | null | Help text below component |

### Compression Options

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `webpQuality` | number | 85 | WebP compression quality (0–100, higher = better) |
| `minSizeToCompress` | number | 500 | Skip files smaller than this (KB) to save CPU time |
| `maxWidth` | number | 2000 | Max image width before resizing |
| `maxHeight` | number | 2000 | Max image height before resizing |
| `enableAnnotation` | boolean | false | Enable photo editor overlay for single images |

## Photo Annotation Feature

When `enableAnnotation={true}` is set and you are adding a *single* attachment, an annotation editor overlay appears on top of the image. This enables:
- Drawing arrows directly on images
- Resizing the original image (max zoom of 5x)

## Development Commands

```bash
# Install dependencies
yarn install

# Build for production
yarn build

# Watch mode (for development)
yarn watch
```

## Architecture Overview

- **`Component.svelte`**: Main Svelte component handling file upload, WebP conversion via Canvas API, and optional annotation editor
- **Conversion Logic**: Uses browser-native Canvas `toBlob()` with quality parameter for efficient client-side compression without external libraries

## License

MIT
