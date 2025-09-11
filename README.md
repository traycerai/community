# Traycer: Full Spectrum Planning

Traycer transforms your ideas into clear, step-by-step plans that AI coding tools like Claude Code and Cursor can follow easily. Spend less time writing prompts and complete your projects faster.

- ✨ Detailed step by step implementation plans
- ✅ Perfect for large scale code refactoring and feature roll
- 🛠️ Seamless IDE integration (Copilot, Cursor, Windsurf, etc)
- 🤖 Powered by cutting-edge AI models like Sonnet 4, o3, GPT 5, GPT 4.1 and more
- 🎁 Free to use forever
- 🚀 7 day Pro trial, no credit card needed

<br />

<video src="https://github.com/user-attachments/assets/08a4dcfb-29e8-48b6-8495-e455a4af6793" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
Unable to load video.
</video>

## Important Links

- **[Free 7-day trial](https://platform.traycer.ai)**: Get started with Traycer by signing up for a free 7-day trial. No credit card required.
- **[Plans & Pricing](https://traycer.ai/#pricing)**: Explore our subscription plans and pricing options to choose the best fit for your needs.
- **[FAQs](https://traycer.ai/#faq)**: Find answers to common questions about Traycer, its features, and usage.

## Features

### Tasks

---

Traycer converts user intent into detailed implementation plans that are then sent to code-generation tools, resulting in better outcomes.

- **Detailed implementation plans**: Traycer analyzes the user’s codebase and provides detailed plans based on the user query, indicating which files need to be changed and where. Additionally, it explains the approach taken and the reasoning behind it.

- **Plan Iteration**: The user can iterate on the plan to perfection. Traycer allows plan editing with surgical precision. Moreover, the user can ask questions and seek explanations for any queries they may have in Plan Chat.

- **Hand-Off**: Once satisfied, the Traycer plan is sent to the agent of choice for code generation. Currently, Traycer supports the following agents:
  - Claude Code
  - Cursor
  - Gemini
  - Codex
  - Windsurf
  - Cline
  - RooCode
  - KiloCode
  - And more...

- **Task Chaining**: When one task is completed, another can be chained, and all context is retained from previous tasks. This is especially useful when working in large codebases.

#### Task List

Traycer maintains a log of your completed and ongoing tasks in the Task List panel. Each entry displays the task description and its current status, such as `"Planning"`, `"Plan Generated"` etc. You can revisit any task to view its details or pick up where you left off.

<img src="https://assets.traycer.ai/task_list.png" alt="Task-list" style="width: 30%; height: auto;">

### Review

---

Review scans the codebase, identifies bugs, and suggests improvements to security, readability, and adherence to best practices.

- **Automatic Analysis** (_Pro users only_): When enabled, Traycer continuously tracks your activities and performs analysis in real-time. Analysis is triggered automatically by events such as saving your work.

- **Manually Triggered Analysis**: Available to all users, this allows users to initiate the analysis at your convenience through various methods, providing flexibility and control.
  - **Analyze Changes In File**: This option focuses solely on recently modified functions in the currently open file. It's ideal for quickly verifying modifications without analyzing unchanged parts of the file.
  - **Analyze Changes In Workspace**: This option reviews all modified files in the workspace, providing a comprehensive analysis of recent changes across multiple files.
  - **Analyze File**: This option comprehensively reviews the entire file, regardless of recent changes. It checks the code for consistency, errors, and adherence to coding standards.

#### Switching Between Manual and Automated Analysis

Configure your preferences to switch between manual and automated analysis modes.

#### Different ways to switch between Manual and Automated Analysis

1. **Using Command Palette: -**
   - Open the Command Palette in VS Code (`Ctrl+Shift+P` OR `Cmd+Shift+P` on Mac).
   - Type and select `Traycer: Enable Auto Analysis` OR `Traycer: Disable Auto Analysis`.

2. **Extension Settings Page:**
   - Go to the Traycer extension settings page in VS Code.
   - Enable or disable the "Traycer: Enable Auto Analysis" setting.

#### Manually Triggered Analysis

This allows users to have full control over when the analysis runs. Users can trigger the analysis process manually, making it useful for reviewing and refining code at specific points in the development workflow.

##### Different ways to trigger Analysis manually

1. **Editor Toolbar**: Click the Traycer icon on the top editor toolbar to trigger analysis on the current file.

   ![Editor Toolbar](https://github.com/user-attachments/assets/6ed8f703-1a36-4d8d-8153-96c8e6f1c93a)

2. **Right-click Menu**: Right-click anywhere in the code file and select Traycer > `Analyze File`, `Analyze Changes in File`, or `Analyze Changes in Workspace`.

3. **Command Palette**: Run `Traycer: Analyze File`, `Traycer: Re-Analyze File`, `Traycer: Analyze Changes in File`, or `Traycer: Analyze Changes in Workspace` from the command palette by using `Ctrl + Shift + P` or `Cmd + Shift + P`.

#### Comment Indicator

Specifies how comments are displayed in the editor. [Modify preferences](#preferences) to choose from the following options:

![Comment Indicator](https://github.com/user-attachments/assets/5d2cec44-3516-4ad5-9f5f-f765c0cd9b07)

1. **CodeLens:** Displays comments above the relevant lines of code, providing inline context.
2. **Hover Tooltips:** Shows comments when you hover over the relevant lines of code.
3. **Both (default):** Combines CodeLens and hover tooltips, ensuring comments are always visible while also providing additional context on hover.

#### Analysis History

Keeps a record of all past analyses performed, allowing you to review and track changes over time. Each entry includes key details such as the trigger type, state of completion, duration, and statistical breakdowns of the analysis. You can monitor the number of successfully analyzed code blocks, failed analyses, skipped sections, and other relevant metrics, helping you understand the effectiveness and progress of your code improvements.

To access the analysis history, follow these steps:

1. Open the Traycer side panel by clicking on the icon in the activity bar.
2. Click on the history icon at the top.
3. View the history for each analysis.

![Analysis History](https://github.com/user-attachments/assets/3e4b7952-0a2d-40dd-bcca-e7ae117874a3)

### Ticket Assist

---

Traycer’s Ticket Assist automates your ticketing workflow. It connects to your GitHub repositories and automatically creates action plans for your GitHub issues that you can then transfer to your IDE.

See the [Traycer AI GitHub App page](https://github.com/apps/traycerai) for more details.

## Preferences

Customize your Traycer settings to fit your development workflow and preferences.

To modify any setting, follow these steps:

1. Open the Traycer side panel by clicking on the icon in the activity bar.
2. Click on the gear icon at the top.
3. Modify the settings as needed.

## Feedback Forum

We value your input and encourage you to share your experiences and suggestions with us. Connect with us and the community in the following ways:

- **Discord**: [Join our community here](https://discord.gg/RcpPtcZqRK)
- **X (Twitter)**: Follow us [@TraycerAI](https://twitter.com/TraycerAI)
- **GitHub**: Encounter a bug or have a feature request? File an issue on our [community repository](https://github.com/traycerai/community/issues).

### Terms of Service and Privacy Policy

By using Traycer, you agree to our [Terms of Service](https://traycer.ai/terms-of-service) and [Privacy Policy](https://traycer.ai/privacy-policy).
