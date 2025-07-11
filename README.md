# Traycer: AI-Powered Coding, Refined

## What's Traycer?

Traycer is an AI-powered coding assistant that transforms how you handle coding tasks. With its **Tasks** feature, Traycer helps you define objectives, generate actionable plans, and implement changes seamlessly. Whether you need to fix bugs, refactor code, or create new features, Traycer analyzes your input and automates the process while keeping you in control. Alongside tasks, Traycer offers real-time, context-aware **Reviews**, identifying issues, optimizing performance, and improving code quality—all without disrupting your workflow.

## Table of Content

- [Important Links](#important-links)
- [Features](#features)
  - [Tasks](#tasks)
    - [User Query](#user-query)
    - [Plan Specification](#plan-specification)
    - [Code Changes](#code-changes)
    - [Task History](#task-history)
  - [Ticket Assist](#ticket-assist)
  - [Review](#review)
    - [Triggering Analysis](#triggering-analysis-manual-vs-automated)
    - [Switching Between Manual and Automated Analysis](#switching-between-manual-and-automated-analysis)
    - [Manually Triggered Analysis](#manually-triggered-analysis)
    - [Checking Analysis Status](#checking-analysis-status)
    - [Comments & Replies](#comments--replies)
      - [(A) Navigator](#a-navigator)
    - [Learnings](#learnings)
      - [How It Works](#how-it-works)
      - [Managing Learnings](#managing-learnings)
    - [Analysis History](#analysis-history)
- [Preferences](#preferences)
  - [Modifying Settings](#modifying-settings)
    - [Via Extension Settings Page](#via-extension-settings-page)
    - [Via Command Palette](#via-command-palette)
    - [Via Side Panel Preferences](#via-side-panel-preferences)
  - [Auto Analysis](#auto-analysis)
  - [Comment Indicator](#comment-indicator)
  - [Comments Highlighting](#comments-highlighting)
  - [Output Level](#output-level)
- [Feedback Forum](#feedback-forum)
- [Terms of Service and Privacy Policy](#terms-of-service-and-privacy-policy)

## Important Links

- **[Free 14-day trial](https://platform.traycer.ai)**: Get started with Traycer by signing up for a free 14-day trial. No credit card required.
- **[Plans & Pricing](https://traycer.ai/#pricing)**: Explore our subscription plans and pricing options to choose the best fit for your needs.
- **[FAQs](https://traycer.ai/#faq)**: Find answers to common questions about Traycer, its features, and usage.

## Features

### Tasks

The Tasks feature allows you to define high-level objectives, and Traycer works autonomously to analyze and modify your code to accomplish them. Whether it's fixing bugs, creating new features, or optimizing existing code, you can rely on Traycer to handle complex coding tasks seamlessly.

<video src="https://github.com/user-attachments/assets/ab5c77e8-30e9-4996-87a2-8433180ed3de" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
  Unable to load video.
</video>

#### User Query

Enter your task in the input box (e.g., "Refactor the login module") and use @mention or the + icon to specify files or folders (e.g., `@auth.js`, `@utils/`). Once done, click the `"Generate Plan"` button to proceed.

![Task-User-Query](https://github.com/user-attachments/assets/b2a31035-6564-49c1-9718-5550a845edc7)

#### Plan Specification

Traycer generates a plan with steps for your task. You can edit the plan directly, _add or remove files_, or include reference files for context. Click the `"Generate Changes"` button when ready.

![Plan-Spec](https://github.com/user-attachments/assets/81961af3-d7bd-4a0e-be99-4faed1ad6fe5)

#### Code Changes

Traycer displays the code changes for each file in the plan in a structured view. You can click on any file to expand its details and review the changes. Each file includes options to **Show Diff**, allowing you to compare the proposed changes with the original code, and **Apply**, enabling you to integrate the changes into your codebase instantly. Selecting a file also opens a dedicated chat interface, where you can discuss, refine, or further customize the changes before applying them.

![Code-Changes](https://github.com/user-attachments/assets/1635967e-36e3-403f-996a-6a0cfca10eb7)

#### File-Specific Chat

Traycer provides a dedicated chat interface for each file in the task, enabling focused collaboration and refinement. Once you select a file, you can view the proposed changes and engage with Traycer to discuss, clarify, or request additional modifications. The chat ensures a streamlined workflow by offering the following capabilities:

- Interactive Discussions: Provide feedback, ask questions, or request updates directly within the chat for that specific file.
- Dynamic Updates: Traycer responds to your input by refining the code changes or implementing new suggestions.
- Actionable Options: Each interaction displays options like `Show Diff` for comparing changes and `Apply` to integrate updates seamlessly into your codebase.
This file-specific chat enhances collaboration and ensures the proposed changes align perfectly with your goals.

![Task-chat](https://github.com/user-attachments/assets/a17d2d93-51f4-4711-b2e8-07f18591a2e5)

#### Task History

Traycer maintains a log of your completed and ongoing tasks in the Task History panel. Each entry displays the task description and its current status, such as `"Planning"`, `"Plan Generated"` etc. You can revisit any task to view its details or pick up where you left off, ensuring a seamless workflow and easy access to past and ongoing tasks.

![Task-history](https://github.com/user-attachments/assets/9e2f3872-eccb-4fb6-985c-d5c93506e9d8)

### Ticket Assist

Traycer’s Ticket Assist automates your ticketing workflow. It connects to your GitHub repositories and automatically creates action plans for your GitHub issues that you can then transfer to your IDE.

See the [Traycer AI GitHub App page](https://github.com/apps/traycerai) for more details.

### Review

The Review feature allows you to analyze your code for potential issues, enhancements, and best practices. Traycer provides detailed suggestions to improve code quality, including bug fixes, performance optimizations, and adherence to coding standards. You can trigger reviews manually or let Traycer automatically analyze changes in real-time, ensuring your code is always at its best.

<video src="https://github.com/user-attachments/assets/79811371-9ec0-49ca-8d5a-b2edeb09c65e" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
  Unable to load video.
</video>

#### Triggering Analysis: Manual vs. Automated

Traycer provides flexibility in how you trigger code analysis:

1. **Automatic Analysis** (Pro users only)
   When enabled, Traycer continuously tracks your activities and performs analysis in real-time. Analysis is triggered automatically by events such as saving your work.
2. **Manually Triggered Analysis**
   Available to all users, this allows users to initiate the analysis at your convenience through various methods, providing flexibility and control.
   - **Analyze File:** This option comprehensively reviews the entire file, regardless of recent changes. It checks the code for consistency, errors, and adherence to coding standards.
   - **Re-Analyze File:** This option behaves similarly to `Analyze File` but is useful for re-evaluating the entire file without evaluating what has already been analyzed in a previous analysis.
   - **Analyze Changes in File:** This option focuses solely on recently modified functions in the currently open file. It's ideal for quickly verifying modifications without analyzing unchanged parts of the file.
   - **Analyze Changes in Workspace:** This option reviews all modified files in the workspace, providing a comprehensive analysis of recent changes across multiple files.

#### Switching Between Manual and Automated Analysis

Configure your preferences to switch between manual and automated analysis modes.

#### Different ways to switch between Manual and Automated Analysis

1. **Using Command Palette: -**

   - Open the Command Palette in VS Code (`Ctrl+Shift+P` OR `Cmd+Shift+P` on Mac).
   - Type and select `Traycer: Enable Auto Analysis` OR `Traycer: Disable Auto Analysis`.

2. **Extension Settings Page:**

   - Go to the Traycer extension settings page in VS Code.
   - Enable or disable the "Traycer: Enable Auto Analysis" setting.
     <br/><br/>

     <video src="https://github.com/traycerai/community/assets/76090263/262b6321-50d7-4f3c-8348-dbaa262bd816" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
      Unable to load video.
     </video>

#### Manually Triggered Analysis

This allows users to have full control over when the analysis runs. Users can trigger the analysis process manually, making it useful for reviewing and refining code at specific points in the development workflow.

##### Different ways to trigger Analysis manually

1. **Editor Toolbar**: Click the Traycer icon on the top editor toolbar to trigger analysis on the current file.

   ![Editor Toolbar](https://github.com/user-attachments/assets/6ed8f703-1a36-4d8d-8153-96c8e6f1c93a)

2. **Right-click Menu**: Right-click anywhere in the code file and select Traycer > `Analyze File`, `Re-Analyze File`, `Analyze Changes in File`, or `Analyze Changes in Workspace`.

3. **Command Palette**: Run `Traycer: Analyze File`, `Traycer: Re-Analyze File`, `Traycer: Analyze Changes in File`, or `Traycer: Analyze Changes in Workspace` from the command palette by using `Ctrl + Shift + P` or `Cmd + Shift + P`.

#### Checking Analysis Status

To check the status of your analysis, **hover** over the Traycer icon. It will display the count of running analyses, such as "Traycer in-flight analysis: X". If the count is 0, it means there are no analyses currently running.

<video src="https://github.com/traycerai/community/assets/76090263/b25b9c67-9ed0-4e66-8e20-504544cd8d10" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
  Unable to load video.
</video>

#### Comments & Replies

Traycer adds comments to your code, suggesting improvements and highlighting potential issues such as bugs, performance, security, and clarity. These comments provide actionable insights to help you refine your code, maintain high standards, and address problems early in the development process. Additionally, you can reply to comments to engage in a conversation with Traycer, allowing you to discuss and resolve issues directly within the context of each comment.

![Comments & Replies](https://github.com/user-attachments/assets/b27f2de5-14f2-4561-9724-08c1ab5b772f)

#### (A) Navigator

To navigate and manage comments in Traycer, follow these steps:

1. Open the side panel by clicking on the Traycer icon in the activity bar.
2. Browse through the list of comments categorized by labels such as `bugs`, `performance`, `security`, and `clarity`.
3. Use the **Wand icon** (🪄) next to a comment to directly apply the suggested fix, if the icon is present. Some comments may not have a suggestion.
4. Use the search box to find comments by text, filename, or file path.

#### Learnings

Learnings enable Traycer to capture user preferences and code-relevant insights from your interactions. When you reply to comments, Traycer analyzes your responses to identify preferences or learnings, saving them to improve future analyses and recommendations.

##### How It Works

- **Automatic Detection**: Traycer scans your replies for indications of coding style preferences, tool configurations, or best practices you follow.
- **Personalized Experience**: The saved learnings enable Traycer to tailor its feedback and suggestions to align with your specific needs and preferences.
- **Continuous Improvement**: Ongoing interactions help Traycer better understand your coding habits and requirements.

##### Managing Learnings

- **Accessing Learnings**: Click on the Learnings icon in the menu to view your saved learnings.

  ![Access Learnings](https://github.com/user-attachments/assets/7912f3e5-a4f6-4bfb-9ad5-b3fd5916367f)

  See the list of all the learnings you've accumulated:

  ![Learnings List](https://github.com/user-attachments/assets/465159dc-8b42-4186-91cf-17a9d9296835)

- **Deleting Learnings**: Click the Bin icon next to the learning you wish to delete.
- **Adding Learnings Manually**: You can manually add new learnings by clicking the Plus icon. Specify preferences or insights directly without waiting for Traycer to capture them in your replies.
- **Privacy Control**: Your privacy is important. Traycer provides a setting in the [Platform](https://platform.traycer.ai/settings) where you can opt out of the Learnings feature anytime. Opting out will delete all existing learnings. Note that the learning feature is on by default.

#### Analysis History

Keeps a record of all past analyses performed, allowing you to review and track changes over time. Each entry includes key details such as the trigger type, state of completion, duration, and statistical breakdowns of the analysis. You can monitor the number of successfully analyzed code blocks, failed analyses, skipped sections, and other relevant metrics, helping you understand the effectiveness and progress of your code improvements.

To access the analysis history, follow these steps:

1. Open the Traycer side panel by clicking on the icon in the activity bar.
2. Click on the history icon at the top.
3. View the history for each analysis.

![Analysis History](https://github.com/user-attachments/assets/3e4b7952-0a2d-40dd-bcca-e7ae117874a3)

### Preferences

Customize your Traycer settings to fit your development workflow and preferences.

#### Modifying Settings

To modify any setting, follow these steps:

##### Via Extension Settings Page

1. Click on the gear icon in the lower-left corner and select "Settings," or use the shortcut `Ctrl + ,` (`Cmd + ,` on Mac).
2. In the settings search bar, type "Traycer" to filter and find all related settings.
3. Modify any of the Traycer settings as needed.

##### Via Command Palette

1. Open the command palette by pressing `Ctrl + Shift + P` (`Cmd + Shift + P` on Mac).
2. Type "Traycer" to view and select various commands related to Traycer settings.
3. Execute the desired command to modify the settings.

##### Via Side Panel Preferences

1. Open the Traycer side panel by clicking on the icon in the activity bar.
2. Click on the gear icon at the top.
3. Modify the settings as needed.

#### Auto Analysis

Controls whether Traycer automatically analyzes your code as you work.

1. **Enabled:** (Pro users only) Traycer continuously tracks your activities and performs analysis in real-time as you write and modify your code. Analysis is triggered automatically by events such as saving your work.

2. **Disabled:** Users have full control over when the analysis runs. You can trigger the analysis process manually at specific points in your development workflow, either for the entire file or only for recent changes.

#### Comment Indicator

Specifies how comments are displayed in the editor. You can choose from the following options:

![Comment Indicator](https://github.com/user-attachments/assets/5d2cec44-3516-4ad5-9f5f-f765c0cd9b07)

1. **CodeLens:** Displays comments above the relevant lines of code, providing inline context.
2. **Hover Tooltips:** Shows comments when you hover over the relevant lines of code.
3. **Both (default):** Combines CodeLens and hover tooltips, ensuring comments are always visible while also providing additional context on hover.

#### Comments Highlighting

Specifies how comments are highlighted in the editor. Highlighting is useful for quickly identifying code lines with comments. You can enable or disable highlighting and customize the color to fit your preferences. The default setting is disabled.

#### Output Level

Specifies how much (if any) output will be sent to the Traycer output channel. You can configure the level of detail for the output, ranging from minimal to detailed logs. The default level is set to "info".

### Feedback Forum

We value your input and encourage you to share your experiences and suggestions with us. Connect with us and the community in the following ways:

- **Discord**: Join our community [here](https://discord.gg/RcpPtcZqRK)

- **X (Twitter)**: Follow us [@TraycerAI](https://twitter.com/TraycerAI)

- **GitHub**: Encounter a bug or have a feature request? File an issue on our [community repository](https://github.com/traycerai/community/issues).

## Terms of Service and Privacy Policy

By using Traycer, you agree to our [Terms of Service](https://traycer.ai/terms-of-service) and [Privacy Policy](https://traycer.ai/privacy-policy).
