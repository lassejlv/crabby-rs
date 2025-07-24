<div align="center">

<img src="src-tauri/icons/icon.png" alt="Crabby Icon" width="128" height="128">

# Crabby

### Cross-platform terminal emulator written in Rust

*Built with Tauri for native performance and modern web technologies*

## ✨ Features

• **Fast & Lightweight** - Built with Rust for maximum performance

• **Cross-Platform** - Works on Windows, macOS, and Linux

• **Modern UI** - Clean interface with customizable themes

• **Native Feel** - Powered by Tauri for true native experience

• **Terminal Emulation** - Full-featured terminal with modern capabilities

• **Command Palette** - Quick access to all features via Cmd+P (macOS) or Ctrl+P (Windows/Linux)

## 📦 Installation

### Homebrew (macOS)

```bash
# Add the tap
brew tap lassejlv/crabby

# Install Crabby
brew install crabby
```

### Manual Installation

Download the latest release from the [releases page](https://github.com/lassejlv/crabby-rs/releases).

## 🚀 Usage

After installation, you can launch Crabby from:
- Command line: `crabby`
- Applications folder (macOS)
- Start menu (Windows)

### Command Palette

Press **Cmd+P** (macOS) or **Ctrl+P** (Windows/Linux) to open the command palette for quick access to all features:

- **Tab Management**: Create new tabs, close tabs, switch between tabs
- **Terminal Controls**: Adjust font size, clear terminal
- **Application**: Reload app, view about information

The command palette supports fuzzy search - just start typing to filter commands.

### Keyboard Shortcuts

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Command Palette | `Cmd+P` | `Ctrl+P` |
| New Tab | `Cmd+T` | `Ctrl+T` |
| Close Tab | `Cmd+W` | `Ctrl+W` |
| Increase Font | `Cmd+=` | `Ctrl+=` |
| Decrease Font | `Cmd+-` | `Ctrl+-` |
| Reset Font | `Cmd+0` | `Ctrl+0` |
| Reload App | `Cmd+R` | `Ctrl+R` |

### Custom Commands

Developers can extend Crabby with custom commands using the command API:

```typescript
// Register a new command
commandManager.registerCommand({
  id: 'my-custom-command',
  title: 'My Custom Command',
  description: 'Does something awesome',
  category: 'Custom',
  shortcut: 'Ctrl+Shift+A',
  icon: '⚡',
  action: () => {
    // Your custom logic here
    console.log('Custom command executed!');
  }
});
```

## 🛠️ Development

To build from source:

```bash
# Clone the repository
git clone https://github.com/lassejlv/crabby-rs.git
cd crabby-rs

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## 📝 License

This project is licensed under the MIT License.
