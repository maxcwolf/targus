# Config file

`targus.config.ts`, or `targus.config.json`, names the platforms a project captures and the
settings of each ([ADR 0038](../adr/0038-a-config-file-chooses-the-platforms.md),
[ADR 0039](../adr/0039-a-typed-typescript-config-file.md)). It is optional: without it the CLI
captures iOS from its flags, as it always has.

`targus capture` and `targus run` look for `targus.config.ts`, then `targus.config.json`, in the
directory they run in, and stop if both are there. `--config <path>` names another file, which
must exist. Relative paths in the config are relative to its file, so a run from another
directory finds them.

## TypeScript

`defineConfig` types the file, so your editor completes and checks every key:

```ts
// targus.config.ts
import { defineConfig } from '@targus/cli';

export default defineConfig({
  platforms: {
    ios: {
      app: 'build/MyApp.app',
      deviceName: 'iPhone 16',
      appearance: 'light',
      bundleId: 'com.example.myapp',
    },
    web: {
      storybook: 'storybook-static',
      viewport: '1200x900',
      pixelRatio: 1,
      deviceName: 'Chrome desktop',
    },
  },
});
```

Node loads the file itself by stripping the types, which needs **Node 22.18 or later**. That
leaves out TypeScript that needs compiling, such as `enum`, which a config has no use for. The
type is also exported as `TargusConfig`, for `satisfies TargusConfig` instead of `defineConfig`.
`--config` loads `.mts`, `.js` and `.mjs` files the same way.

## JSON

The same config as JSON, for older Node or a project without TypeScript:

```json
{
  "platforms": {
    "ios": { "app": "build/MyApp.app", "deviceName": "iPhone 16" },
    "web": { "storybook": "storybook-static", "viewport": "1200x900" }
  }
}
```

`$schema` is allowed for editors and is not read.

Either way, name at least one platform. An unknown key is an error, so a typo is never silently
ignored. Keep secrets (`TARGUS_TOKEN`) and machine-specific settings (a simulator UDID) out of the
file: they belong in the environment and in flags.

## Which platforms a run captures

1. `--platform`, when given: `ios`, `web`, or both as `ios,web`.
2. Otherwise every platform the config names, iOS first.
3. Otherwise iOS.

`targus run` publishes each platform as its own build with its own check, `targus/ios` or
`targus/web`. When one platform fails, it still publishes the others, then exits with the first
error. `targus capture` writes one capture, so with a config that names both it needs
`--platform`.

A flag always wins over the config: `--app`, `--udid`, `--storybook` and the rest override the
value in the file for that run. `--device-name` names one device, so a run of both platforms
refuses it: set `deviceName` for each platform in the file instead.

## `platforms.ios`

| Key          | Flag            | Meaning                                                           |
| ------------ | --------------- | ----------------------------------------------------------------- |
| `app`        | `--app`         | The simulator `.app` to install and launch.                       |
| `udid`       | `--udid`        | The simulator to capture on.                                      |
| `deviceName` | `--device-name` | The device recorded on the build; default: the simulator's name.  |
| `appearance` | `--appearance`  | `light` or `dark`, pinned for the capture; default `light`.       |
| `bundleId`   | `--bundle-id`   | The app's bundle id; default: read from the `.app`.               |

## `platforms.web`

| Key          | Flag            | Meaning                                                          |
| ------------ | --------------- | ---------------------------------------------------------------- |
| `storybook`  | `--storybook`   | A built Storybook directory, or the `http(s)://` URL of one.     |
| `viewport`   | `--viewport`    | `WIDTHxHEIGHT` in CSS pixels; default `1200x900`.                |
| `pixelRatio` | `--pixel-ratio` | Device pixels per CSS pixel, above 0 and at most 4; default `1`. |
| `deviceName` | `--device-name` | The device recorded on the build; default: the browser version.  |

See [Capture a web Storybook](../guide/web.md) for what a web capture does with them.
