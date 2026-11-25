// GENERATED FILE — do not edit by hand.
// dart format off
//
// Generated from `CAPABILITIES` in `src/server/protocol.ts`.
// Regenerate: `bun run scripts/generate-dart-bindings.ts`.
//
// The shell calls `CoreMethod.sessionList` instead of `'session.list'`, so a
// renamed capability changes this file and a stale call site stops compiling.

abstract final class CoreMethod {
  static const String workspaceInfo = 'workspace.info';
  static const String sessionList = 'session.list';
  static const String sessionOpen = 'session.open';
  static const String sessionCoverage = 'session.coverage';
  static const String sessionCreate = 'session.create';
  static const String sessionToggleStep = 'session.toggleStep';
  static const String sessionGenerateSteps = 'session.generateSteps';
  static const String sessionDocument = 'session.document';
  static const String sessionInstructionsGet = 'session.instructions.get';
  static const String sessionInstructionsSave = 'session.instructions.save';
  static const String sessionInstructionsImport = 'session.instructions.import';
  static const String sessionInstructionsReextract = 'session.instructions.reextract';
  static const String sessionArchive = 'session.archive';
  static const String sessionRemove = 'session.remove';
  static const String sessionExport = 'session.export';
  static const String sessionOutputBuild = 'session.output.build';
  static const String sessionOutputRead = 'session.output.read';
  static const String sessionOutputMark = 'session.output.mark';
  static const String sessionDeckState = 'session.deck.state';
  static const String sessionDeckGrade = 'session.deck.grade';
  static const String sessionDeckReset = 'session.deck.reset';
  static const String sessionFigureList = 'session.figure.list';
  static const String sessionFigureExtract = 'session.figure.extract';
  static const String sessionFigureRead = 'session.figure.read';
  static const String sessionFigureAnnotate = 'session.figure.annotate';
  static const String sessionFigureRemove = 'session.figure.remove';
  static const String sessionMistakeList = 'session.mistake.list';
  static const String sessionMistakeRecord = 'session.mistake.record';
  static const String sessionMistakePromote = 'session.mistake.promote';
  static const String sessionMistakeCorrect = 'session.mistake.correct';
  static const String archiveList = 'archive.list';
  static const String archiveRestore = 'archive.restore';
  static const String archiveRemove = 'archive.remove';
  static const String sourceList = 'source.list';
  static const String sourceAdd = 'source.add';
  static const String statsSummary = 'stats.summary';
  static const String statsExport = 'stats.export';
  static const String achievementsList = 'achievements.list';
  static const String settingsGet = 'settings.get';
  static const String decisionGet = 'decision.get';
  static const String decisionSet = 'decision.set';
  static const String keybindsGet = 'keybinds.get';
  static const String keybindsSet = 'keybinds.set';
  static const String chatSnapshot = 'chat.snapshot';
  static const String chatSend = 'chat.send';
  static const String chatCancel = 'chat.cancel';
  static const String sessionChatSnapshot = 'session.chat.snapshot';
  static const String sessionChatSend = 'session.chat.send';
  static const String sessionChatCancel = 'session.chat.cancel';
  static const String sessionChatContext = 'session.chat.context';
  static const String sessionChatCompact = 'session.chat.compact';
  static const String sessionChatUncompact = 'session.chat.uncompact';
  static const String providerList = 'provider.list';
  static const String providerLink = 'provider.link';
  static const String settingsPatch = 'settings.patch';
  static const String themeCustomGet = 'theme.custom.get';
  static const String themeCustomSet = 'theme.custom.set';
  static const String workList = 'work.list';
  static const String workOpen = 'work.open';
  static const String workCreate = 'work.create';
  static const String workTemplatesList = 'work.templates.list';
  static const String workAgentSave = 'work.agent.save';
  static const String workAgentDelete = 'work.agent.delete';
  static const String workDefaultAgent = 'work.defaultAgent';
  static const String workChanges = 'work.changes';
  static const String workWritePropose = 'work.write.propose';
  static const String workWriteDecide = 'work.write.decide';
  static const String workCommandPropose = 'work.command.propose';
  static const String workCommandDecide = 'work.command.decide';
  static const String workPermissionsGet = 'work.permissions.get';
  static const String workPermissionsSet = 'work.permissions.set';
  static const String workApprovalsList = 'work.approvals.list';
  static const String workChatList = 'work.chat.list';
  static const String workChatOpen = 'work.chat.open';
  static const String workChatSend = 'work.chat.send';
  static const String workChatCancel = 'work.chat.cancel';
  static const String workSwarmRun = 'work.swarm.run';
  static const String workSwarmBoard = 'work.swarm.board';
  static const String workSwarmRuns = 'work.swarm.runs';
  static const String workSwarmCancel = 'work.swarm.cancel';
  static const String workSwarmRemove = 'work.swarm.remove';
  static const String workSwarmRetry = 'work.swarm.retry';
  static const String workSwarmVerify = 'work.swarm.verify';
  static const String activityList = 'activity.list';
  static const String mcpList = 'mcp.list';
  static const String mcpRefresh = 'mcp.refresh';
  static const String mcpPolicyGet = 'mcp.policy.get';
  static const String mcpPolicySet = 'mcp.policy.set';
  static const String mcpConfirm = 'mcp.confirm';
  static const String skillList = 'skill.list';
  static const String skillOpen = 'skill.open';
  static const String skillChapter = 'skill.chapter';
  static const String skillCreate = 'skill.create';
  static const String skillStagesSave = 'skill.stages.save';
  static const String skillArchive = 'skill.archive';
  static const String skillRemove = 'skill.remove';
  static const String skillExport = 'skill.export';
  static const String skillLessonBuild = 'skill.lesson.build';
  static const String skillLessonRead = 'skill.lesson.read';
  static const String teachState = 'teach.state';
  static const String teachMeasure = 'teach.measure';
  static const String teachStep = 'teach.step';
  static const String teachCheck = 'teach.check';
  static const String teachPractice = 'teach.practice';
  static const String teachPracticeResult = 'teach.practice.result';
  static const String teachSideSnapshot = 'teach.side.snapshot';
  static const String teachSideSend = 'teach.side.send';
  static const String teachSideClear = 'teach.side.clear';
  static const String researchStart = 'research.start';
  static const String researchList = 'research.list';
  static const String researchRead = 'research.read';
  static const String researchCancel = 'research.cancel';
  static const String promptsList = 'prompts.list';
  static const String promptsSet = 'prompts.set';
  static const String updateInfo = 'update.info';
  static const String updateCheck = 'update.check';
  static const String skillSourcesList = 'skill.sources.list';
  static const String skillSourcesAdd = 'skill.sources.add';
  static const String skillChatList = 'skill.chat.list';
  static const String skillChatOpen = 'skill.chat.open';
  static const String skillChatCreate = 'skill.chat.create';
  static const String skillChatSend = 'skill.chat.send';
  static const String skillChatCancel = 'skill.chat.cancel';
  static const String reviewQueue = 'review.queue';
  static const String reviewMark = 'review.mark';
  static const String knowledgeSearch = 'knowledge.search';
  static const String knowledgeTree = 'knowledge.tree';
  static const String knowledgeRead = 'knowledge.read';
  static const String knowledgeGraph = 'knowledge.graph';

  /// Every generated method, in the core's declaration order.
  static const List<String> all = <String>[
    workspaceInfo,
    sessionList,
    sessionOpen,
    sessionCoverage,
    sessionCreate,
    sessionToggleStep,
    sessionGenerateSteps,
    sessionDocument,
    sessionInstructionsGet,
    sessionInstructionsSave,
    sessionInstructionsImport,
    sessionInstructionsReextract,
    sessionArchive,
    sessionRemove,
    sessionExport,
    sessionOutputBuild,
    sessionOutputRead,
    sessionOutputMark,
    sessionDeckState,
    sessionDeckGrade,
    sessionDeckReset,
    sessionFigureList,
    sessionFigureExtract,
    sessionFigureRead,
    sessionFigureAnnotate,
    sessionFigureRemove,
    sessionMistakeList,
    sessionMistakeRecord,
    sessionMistakePromote,
    sessionMistakeCorrect,
    archiveList,
    archiveRestore,
    archiveRemove,
    sourceList,
    sourceAdd,
    statsSummary,
    statsExport,
    achievementsList,
    settingsGet,
    decisionGet,
    decisionSet,
    keybindsGet,
    keybindsSet,
    chatSnapshot,
    chatSend,
    chatCancel,
    sessionChatSnapshot,
    sessionChatSend,
    sessionChatCancel,
    sessionChatContext,
    sessionChatCompact,
    sessionChatUncompact,
    providerList,
    providerLink,
    settingsPatch,
    themeCustomGet,
    themeCustomSet,
    workList,
    workOpen,
    workCreate,
    workTemplatesList,
    workAgentSave,
    workAgentDelete,
    workDefaultAgent,
    workChanges,
    workWritePropose,
    workWriteDecide,
    workCommandPropose,
    workCommandDecide,
    workPermissionsGet,
    workPermissionsSet,
    workApprovalsList,
    workChatList,
    workChatOpen,
    workChatSend,
    workChatCancel,
    workSwarmRun,
    workSwarmBoard,
    workSwarmRuns,
    workSwarmCancel,
    workSwarmRemove,
    workSwarmRetry,
    workSwarmVerify,
    activityList,
    mcpList,
    mcpRefresh,
    mcpPolicyGet,
    mcpPolicySet,
    mcpConfirm,
    skillList,
    skillOpen,
    skillChapter,
    skillCreate,
    skillStagesSave,
    skillArchive,
    skillRemove,
    skillExport,
    skillLessonBuild,
    skillLessonRead,
    teachState,
    teachMeasure,
    teachStep,
    teachCheck,
    teachPractice,
    teachPracticeResult,
    teachSideSnapshot,
    teachSideSend,
    teachSideClear,
    researchStart,
    researchList,
    researchRead,
    researchCancel,
    promptsList,
    promptsSet,
    updateInfo,
    updateCheck,
    skillSourcesList,
    skillSourcesAdd,
    skillChatList,
    skillChatOpen,
    skillChatCreate,
    skillChatSend,
    skillChatCancel,
    reviewQueue,
    reviewMark,
    knowledgeSearch,
    knowledgeTree,
    knowledgeRead,
    knowledgeGraph,
  ];
}
