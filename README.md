# Traycer: AI-Powered Code Analysis in Real Time

![Basic Usage](https://github.com/traycerai/community/blob/main/readme-assets/basic-usage.gif?raw=true)

# What's Traycer?

Traycer is an advanced code analysis tool for Visual Studio Code, enhancing software quality and developer productivity with live, context-aware insights. Acting like a vigilant senior developer, it analyzes changes in real-time, identifying issues and offering corrections without disrupting your workflow. Traycer ensures comprehensive coverage by examining changes and their implications on related code, addressing potential bugs, and enhancing application robustness. It provides clear, actionable suggestions that can be integrated into your code with a single click.

# Table of Content

- [Features](#features)
  - [Triggering Analysis](#triggering-analysis-manual-vs-automated)
    - [Switching Between Manual and Automated Analysis](#switching-between-manual-and-automated-analysis)
    - [Checking Analysis Status](#checking-analysis-status)
  - [Comments](#comments)
    - [Apply Suggestions](#apply-suggestions)
    - [Show Difference](#show-difference)
    - [Collapse and Expand](#collapse-and-expand-comments)
    - [Delete Comments](#delete-comments)
  - [Comments Highlighting](#comments-highlighting)
- [Supported Languages](#supported-languages)
- [Feedback Forum](#feedback-forum)

# Features

## Triggering Analysis: Manual vs. Automated

Traycer provides flexibility in how you trigger code analysis:

1. **Automatic Analysis**
    - **Real-Time Monitoring:** Traycer automatically tracks your changes and performs analysis in real-time as you write and modify your code.
    - **Event-Based Analysis:** Analysis can be triggered by specific events, such as saving a file. You can turn this feature on or off in the settings.
2. **Manually Triggered Analysis**
    - **Initiating Analysis:** Users can manually start the analysis by right-clicking and selecting "Analyze File" or "Analyze Changes."
    - **Analyze File:** This option comprehensively reviews the entire file, regardless of recent changes. It checks the code for consistency, errors, and adherence to coding standards.
    - **Analyze Changes:** This option focuses solely on recently modified functions. It's ideal for quickly verifying modifications without analyzing unchanged parts of the file.

### Switching Between Manual and Automated Analysis

Configure your preferences to switch between manual and automated analysis modes.

#### Different ways to switch between Manual and Automated Analysis

1. **Using Command Palette: -**
    - Open the Command Palette in VS Code (`Ctrl+Shift+P` OR `Cmd+Shift+P` on Mac).
    - Type and select `Traycer: Enable Auto Analysis` OR `Traycer: Disable Auto Analysis`.

2. **Extension Settings Page:**
    - Go to the Traycer extension settings page in VS Code.
    - Change the "Traycer: Execution Mode" setting to "Manual" or "Auto".
    <br/><br/>
    <video src="https://github.com/traycerai/community/assets/76090263/262b6321-50d7-4f3c-8348-dbaa262bd816" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
      Unable to load video.
    </video>

3. **Change the Settings of VS Code Workspace (.vscode/settings.json):**
    - Add the following line to your workspace settings file:

      ```json
      "traycer.executionMode": "Manual"
      ```

      OR

      ```json
      "traycer.executionMode": "Auto"
      ```

#### Manually Triggered Analysis

This allows users to have full control over when the analysis runs. Users can trigger the analysis process manually by clicking the "Analyze" button in the Traycer right-click menu. This method is useful when you want to review and refine code at specific points in your development workflow.

**Steps to Trigger Manual Analysis**

1. Open your code file in Visual Studio Code.

2. Right-click in the code editor.

3. Select `Traycer` from the context menu.

4. Choose `Analyze File` OR `Analyze Changes` from the sub-menu.

<video src="https://github.com/traycerai/community/assets/76090263/a479e3de-0b95-4763-bfab-de351b1a8449" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
  Unable to load video.
</video>

### Checking Analysis Status

To check the status of your analysis, **hover** over the Traycer icon. It will display the count of running analyses, such as "Traycer in-flight analysis: X". If the count is 0, it means there are no analyses currently running.

<video src="https://github.com/traycerai/community/assets/76090263/b25b9c67-9ed0-4e66-8e20-504544cd8d10" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
  Unable to load video.
</video>

## Comments

Traycer adds comments to your code, suggesting improvements and highlighting potential issues. These comments provide actionable insights to help you refine your code, maintain high standards, and address problems early in the development process.

#### Navigating the Comment

To navigate and manage comments in VS Code, follow these steps:

1. Press `Cmd + J` OR `Ctrl + J` to open the VS Code panel for comments. This panel displays all the comments in the current context.

2. In the comments panel, you can select any comment to interact with.

3. Use the following tools to manage comments:
   - **Apply Suggestion**: Implement the suggested changes directly.
   - **Show Diff**: View the differences between the current and previous versions of the code.
   - **Like**: Indicate approval or agreement with the comment.
   - **Dislike**: Indicate disapproval or disagreement with the comment.
   - **Delete**: Remove the comment from the panel.
   - **Collapse**: Minimize the comment for better focus on other parts of the code.

<video src="https://github.com/traycerai/community/assets/76090263/71eaaf7b-f80b-4e3f-ad8d-1c82df395569" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
  Unable to load video.
</video>

### Apply Suggestions

Using the Traycer extension, you can manage suggestions efficiently. Select the **Apply Suggestion** button provided by the Traycer extension to implement the suggested change directly into your code.
Follow these steps to accept or decline suggestions:

- **Accept Suggestion**
  - After applying the suggestion, review the change.
  - Select the **Accept** button to confirm and finalize the change.
  <br></br>
  <video src="https://github.com/traycerai/community/assets/76090263/c0f4f735-df90-46c4-ab1b-f577d04875cb" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
  Unable to load video.
  </video>

- **Decline Suggestion**:
  - After applying the suggestion, if you decide not to keep the change, select the **Decline** button to revert to the original code.
  <br></br>
  <video src="https://github.com/traycerai/community/assets/76090263/6a5d0582-0ca4-4890-be9d-6fb086557d47" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
  Unable to load video.
  </video>

### Show Difference

Using the Traycer extension, you can easily compare changes made to your code. Follow these steps to view the differences:

- Select the **Show Diff** button provided by the Traycer extension to open a comparison view.

- This view will display the differences between the *original code* and the *suggested* changes side-by-side.

<video src="https://github.com/traycerai/community/assets/76090263/1c686391-a7a0-4093-b9c5-6f3f4b047ebe" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
  Unable to load video.
</video>

### Collapse and Expand Comments

You can collapse or expand comments to manage your workspace efficiently.

#### Follow these steps for collapsing **individual** comment

- **Expand Comment:** Use the *comment* icon (<img src="https://github.com/traycerai/community/assets/76090263/9e7a0bc1-df2e-4cb6-8ab4-80c5b6ebb55e" alt="comment icon" width="20" height="16">) on the left of the code line to expand the comment.

- **Collapse Comment:** Use the *chevron up* icon (<img src="https://github.com/traycerai/community/assets/76090263/17a12214-de96-443b-b3e6-aaf62183499d" alt="chevron up icon" width="16" height="16">) on the top right of the comment box to collapse the comment.

<video src="https://github.com/traycerai/community/assets/76090263/74e4adc7-4e04-498b-9d01-07234e4e3d8e" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
Unable to load video.
</video>

#### To minimize all comments at once

1. **Using Command Palette: -**
    - Open the Command Palette in VS Code (Ctrl+Shift+P or Cmd+Shift+P on Mac).
    - Type and select `Traycer: Collapse All File Comments`

2. **Using right-click menu**
    - Right-click in the code editor.
    - Select `Traycer` from the context menu.
    - Choose `Collapse All File Comments`.
    <br></br>
    <video src="https://github.com/traycerai/community/assets/76090263/a35839bb-32f2-4929-9743-19b9341f2653" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
    Unable to load video.
    </video>

### Delete Comments

Easily remove comments to maintain a clear and efficient workspace, ensuring that your coding environment remains organized and free of unnecessary clutter.

#### To delete **individual** comment

- Use the *trash* icon (<img src="https://github.com/traycerai/community/assets/76090263/39b5b85e-1a38-4d7e-b6fa-fe4288193aa9" alt="trash icon" width="22" height="18">) on the top right of the comment box to delete the comment.

<video src="https://github.com/traycerai/community/assets/76090263/46fbe6f5-9a9a-4412-8919-4e1db4536d32" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
Unable to load video.
</video>

#### To delete all comments at once

1. **Using Command Palette: -**
    - Open the Command Palette in VS Code (Ctrl+Shift+P or Cmd+Shift+P on Mac).
    - Type and select `Traycer: Delete Comments from All Files` - to delete comments from all files.
    - Type and select `Traycer: Delete Comments from Current File` - to delete comments from the **active** file.

2. **Using right-click menu**
    - Open your code file in Visual Studio Code.
    - Right-click in the code editor.
    - Select `Traycer` from the context menu.
    - Choose `Delete All File Comments`.
    <br></br>
    <video src="https://github.com/traycerai/community/assets/76090263/a7755eea-1b51-4d1a-a5b1-1156933b6eef" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
    Unable to load video.
    </video>

## Comments Highlighting

The "Comments Highlighting" feature in Traycer allows users to easily identify and distinguish comments within their code, enhancing readability and code review processes.

#### Different Ways to Enable/Disable Comments Highlighting

1. **Using Command Palette: -**
    - Open the Command Palette in VS Code (Ctrl+Shift+P or Cmd+Shift+P on Mac).
    - Type and select `Traycer: Enable Comments Highlighting` or `Traycer: Disable Comments Highlighting`.

2. **Extension Settings Page:**

    - Go to the Traycer extension settings page in VS Code.
    - Locate the "Traycer: Enable Comments Highlighting" checkbox in the Traycer settings.
    - Check the box to enable this feature.
    <br></br>
    <video src="https://github.com/traycerai/community/assets/76090263/65454231-0c5d-403e-a3ed-0deb59e59c99" controls autoplay loop muted style="max-width: 100%; border: 1px solid black;">
    Unable to load video.
    </video>

3. **Change the Settings of VS Code Workspace (.vscode/settings.json):**
    - Add the following line to your workspace settings file:

      ```json
      "traycer.enableCommentsHighlighting": true
      ```

      OR

      ```json
      "traycer.enableCommentsHighlighting": false
      ```

# Supported Languages

Currently, Traycer supports the following programming languages:

- Python
- TypeScript
- JavaScript
- Golang
- TypeScript React
- JavaScript React
- Rust
- PHP

# Feedback Forum

We value your input and encourage you to share your experiences and suggestions with us. Connect with us and the community in the following ways:

- **Discord**: Join our community [here](https://discord.gg/RcpPtcZqRK)

- **X (Twitter)**: Follow us [@TraycerAI](https://twitter.com/TraycerAI)

- **GitHub**: Encounter a bug or have a feature request? File an issue on our [community repository](https://github.com/traycerai/community/issues).
