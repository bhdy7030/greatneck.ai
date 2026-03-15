type Lang = "en" | "zh";

const translations: Record<string, Record<Lang, string>> = {
  // ── Landing page ──
  "welcome.location": { en: "Long Island, New York", zh: "纽约长岛" },
  "welcome.title": { en: "the neighborhood knows", zh: "家门口的事，问我就对了" },
  "welcome.subtitle": {
    en: "great neck's local ai",
    zh: "Great Neck 自己的 AI",
  },
  "welcome.selectVillage": {
    en: "Select your village to get started",
    zh: "选择你的社区开始提问",
  },
  "welcome.disclaimer": {
    en: "Information provided is for reference only. Always verify with official village resources for legal or permit-related matters.",
    zh: "以上信息仅供参考，涉及法律或许可事宜请以官方资料为准。",
  },

  // ── Events ──
  "events.upcoming": { en: "Upcoming Events", zh: "近期活动" },
  "events.noEvents": { en: "No events in this category", zh: "该分类暂无活动" },
  "events.now": { en: "Now", zh: "现在" },

  // Event categories
  "events.cat.school": { en: "School", zh: "学校" },
  "events.cat.student": { en: "Student", zh: "学生" },
  "events.cat.kids": { en: "Kids", zh: "儿童" },
  "events.cat.teens": { en: "Teens", zh: "青少年" },
  "events.cat.family": { en: "Family", zh: "家庭" },
  "events.cat.art": { en: "Art", zh: "艺术" },
  "events.cat.entertainment": { en: "Art & Entertainment", zh: "艺术与娱乐" },
  "events.cat.food": { en: "Food", zh: "美食" },
  "events.cat.festival": { en: "Festival", zh: "节日" },
  "events.cat.health": { en: "Health", zh: "健康" },
  "events.cat.education": { en: "Education", zh: "教育" },
  "events.cat.community": { en: "Community", zh: "社区" },
  "events.cat.general": { en: "Event", zh: "活动" },

  // Event sources
  "events.src.patch": { en: "Patch", zh: "Patch" },
  "events.src.longisland": { en: "LI Events", zh: "长岛活动" },
  "events.src.eventbrite": { en: "Eventbrite", zh: "Eventbrite" },
  "events.src.islandnow": { en: "Island Now", zh: "Island Now" },
  "events.src.library": { en: "GN Library", zh: "大颈图书馆" },
  "events.src.school": { en: "GN Schools", zh: "大颈学校" },
  "events.src.village": { en: "Village", zh: "村庄" },
  "events.src.parkdistrict": { en: "Park District", zh: "公园管理区" },

  // Source filter labels
  "events.filter.library": { en: "Library", zh: "图书馆" },
  "events.filter.school": { en: "Schools", zh: "学校" },
  "events.filter.village": { en: "Village", zh: "村庄" },
  "events.filter.patch": { en: "Patch", zh: "Patch" },
  "events.filter.longisland": { en: "Long Island", zh: "长岛" },
  "events.filter.eventbrite": { en: "Eventbrite", zh: "Eventbrite" },
  "events.filter.parkdistrict": { en: "Park District", zh: "公园管理区" },
  "events.filter.other": { en: "Other", zh: "其他" },

  // Date ranges
  "events.range.all": { en: "All", zh: "全部" },
  "events.range.today": { en: "Today", zh: "今天" },
  "events.range.tomorrow": { en: "Tomorrow", zh: "明天" },
  "events.range.weekend": { en: "Weekend", zh: "周末" },

  // Date labels
  "events.date.today": { en: "Today", zh: "今天" },
  "events.date.tomorrow": { en: "Tomorrow", zh: "明天" },

  // Weekdays
  "events.weekday.0": { en: "Sun", zh: "周日" },
  "events.weekday.1": { en: "Mon", zh: "周一" },
  "events.weekday.2": { en: "Tue", zh: "周二" },
  "events.weekday.3": { en: "Wed", zh: "周三" },
  "events.weekday.4": { en: "Thu", zh: "周四" },
  "events.weekday.5": { en: "Fri", zh: "周五" },
  "events.weekday.6": { en: "Sat", zh: "周六" },

  // Months
  "events.month.0": { en: "Jan", zh: "1月" },
  "events.month.1": { en: "Feb", zh: "2月" },
  "events.month.2": { en: "Mar", zh: "3月" },
  "events.month.3": { en: "Apr", zh: "4月" },
  "events.month.4": { en: "May", zh: "5月" },
  "events.month.5": { en: "Jun", zh: "6月" },
  "events.month.6": { en: "Jul", zh: "7月" },
  "events.month.7": { en: "Aug", zh: "8月" },
  "events.month.8": { en: "Sep", zh: "9月" },
  "events.month.9": { en: "Oct", zh: "10月" },
  "events.month.10": { en: "Nov", zh: "11月" },
  "events.month.11": { en: "Dec", zh: "12月" },

  // ── Landing page animated questions ──
  "landing.q.fence": { en: "Do I need a permit for a fence?", zh: "安装围栏需要许可证吗？" },
  "landing.q.library": { en: "When is the next library event?", zh: "下次图书馆活动是什么时候？" },
  "landing.q.parking": { en: "What are the parking rules overnight?", zh: "夜间停车规定是什么？" },
  "landing.q.swim": { en: "Where can I sign my kid up for swim lessons?", zh: "哪里可以给孩子报名游泳课？" },
  "landing.q.pothole": { en: "How do I report a pothole?", zh: "如何报告路面坑洞？" },
  "landing.q.basement": { en: "Can I rent out my basement?", zh: "我可以出租地下室吗？" },
  "landing.q.noise": { en: "What's the noise ordinance after 10pm?", zh: "晚上10点后的噪音条例是什么？" },
  "landing.q.senior": { en: "Are there senior programs nearby?", zh: "附近有老年人项目吗？" },
  "landing.q.trash": { en: "What day is trash pickup?", zh: "哪天收垃圾？" },
  "landing.q.restaurants": { en: "Best restaurants in Great Neck?", zh: "大颈最好的餐厅有哪些？" },
  "landing.q.school": { en: "How are the local school ratings?", zh: "当地学校评分怎么样？" },
  "landing.q.tax": { en: "When are property taxes due?", zh: "房产税截止日期是什么时候？" },
  "landing.q.park": { en: "Which parks have playgrounds?", zh: "哪些公园有游乐场？" },
"landing.q.dog": { en: "Are dogs allowed in the parks?", zh: "公园里可以带狗吗？" },
  "landing.q.pool": { en: "How do I get a pool permit?", zh: "如何获得泳池许可证？" },
  "landing.q.weekend": { en: "What's happening this weekend?", zh: "这个周末有什么活动？" },
  "landing.q.ice": { en: "Is the ice rink open tonight?", zh: "今晚溜冰场开放吗？" },
  "landing.q.recycle": { en: "What can I put in recycling?", zh: "哪些东西可以回收？" },
  "landing.q.camp": { en: "Any summer camps for kids?", zh: "有儿童夏令营吗？" },
  "landing.q.waterpark": { en: "When does the Parkwood Pool open?", zh: "Parkwood泳池什么时候开放？" },
  "landing.q.poolfee": { en: "How much is the pool membership fee?", zh: "泳池会员费多少钱？" },
  "landing.q.propane": { en: "New propane tank for my grill", zh: "烤架需要新的丙烷罐" },

  // ── Chat page ──
  "chat.village": { en: "Village:", zh: "社区：" },
  "chat.searchWeb": { en: "Search web:", zh: "网络搜索：" },
  "chat.webOff": { en: "Off", zh: "关闭" },
  "chat.webLimited": { en: "5 max", zh: "最多5条" },
  "chat.webUnlimited": { en: "No limit", zh: "无限制" },
  "chat.changeVillage": { en: "Change village", zh: "换个社区" },
  "chat.howCanIHelp": { en: "How can I help?", zh: "有什么想问的？" },
  "chat.emptySub": {
    en: "Ask about village codes, permit requirements, garbage schedules, snow removal rules, or anything about {village}.",
    zh: "关于{village}的法规、许可、垃圾回收、除雪规定……什么都可以问。",
  },
  "chat.q1": {
    en: "What are the garbage pickup days?",
    zh: "垃圾收集日是哪几天？",
  },
  "chat.q2": {
    en: "Do I need a permit for a fence?",
    zh: "安装围栏需要许可证吗？",
  },
  "chat.q3": {
    en: "What are the snow removal rules?",
    zh: "除雪规定是什么？",
  },
  "chat.q4": {
    en: "Village contact information",
    zh: "村庄联系方式",
  },
  "chat.connecting": { en: "Connecting...", zh: "连接中..." },

  // ── Chat input ──
  "input.placeholder": {
    en: "Can I add a fence? When is recycling pickup? What's the noise ordinance?",
    zh: "我能加围栏吗？回收日是哪天？噪音条例是什么？",
  },
  "input.imageAttached": { en: "Image attached", zh: "已附图片" },

  // ── Sidebar ──
  "sidebar.newChat": { en: "New Chat", zh: "新对话" },
  "sidebar.signInPrompt": {
    en: "Sign in to save your conversations",
    zh: "登录后可以保存对话记录",
  },
  "sidebar.signInGoogle": {
    en: "Sign in with Google",
    zh: "使用 Google 登录",
  },
  "sidebar.signInApple": {
    en: "Sign in with Apple",
    zh: "使用 Apple 登录",
  },
  "sidebar.noConversations": {
    en: "No conversations yet",
    zh: "暂无对话",
  },
  "sidebar.today": { en: "Today", zh: "今天" },
  "sidebar.yesterday": { en: "Yesterday", zh: "昨天" },
  "sidebar.older": { en: "Older", zh: "更早" },

  // ── Theme ──
  "theme.light": { en: "Light", zh: "浅色" },
  "theme.classic": { en: "Classic", zh: "经典" },
  "theme.ocean": { en: "Ocean", zh: "海洋" },
  "theme.hamptons": { en: "Hamptons", zh: "汉普顿" },
  "theme.coral": { en: "Coral", zh: "珊瑚" },
  "theme.nord": { en: "Nord", zh: "北欧" },
  "theme.sage": { en: "Sage", zh: "青翠" },

  // ── Nav ──
  "nav.chat": { en: "Chat", zh: "对话" },
  "nav.ask": { en: "ask", zh: "提问" },

  // ── Auth ──
  "auth.signIn": { en: "Sign in", zh: "登录" },
  "auth.signInGoogle": { en: "Sign in with Google", zh: "使用 Google 登录" },
  "auth.signInApple": { en: "Sign in with Apple", zh: "使用 Apple 登录" },
  "auth.signOut": { en: "Sign out", zh: "退出" },

  // ── Tier / Usage ──
  "tier.trialExhaustedTitle": {
    en: "Want to keep going?",
    zh: "还想继续问？",
  },
  "tier.trialExhaustedDesc": {
    en: "Each answer costs us real AI resources. We limit guest access so we can keep this available for the community. Get 10 more questions below, or sign in for unlimited access.",
    zh: "每次回答都会消耗AI资源，为了让大家都能用，访客有提问次数限制。点下方可以多问10个，或者登录直接无限畅聊。",
  },
  "tier.mustSignInTitle": {
    en: "You're part of the neighborhood",
    zh: "你已经是咱社区的人了",
  },
  "tier.mustSignInDesc": {
    en: "Sign in to keep asking questions, save your conversations, and get the most out of your community assistant. It only takes a second.",
    zh: "登录就能继续提问、保存对话记录，一秒钟的事。",
  },
  "tier.getMoreQueries": {
    en: "Keep Asking",
    zh: "继续提问",
  },
  "tier.signInGoogle": {
    en: "Sign in with Google",
    zh: "使用 Google 登录",
  },
  "tier.signInApple": {
    en: "Sign in with Apple",
    zh: "使用 Apple 登录",
  },
  "tier.signInUnlimited": {
    en: "Sign in",
    zh: "登录",
  },
  "tier.dismiss": {
    en: "Maybe later",
    zh: "以后再说",
  },
  "tier.sponsorOnly": {
    en: "Sponsor feature",
    zh: "赞助者功能",
  },
  "tier.promoBanner": {
    en: "Sponsor features active — {days} days remaining",
    zh: "赞助者功能已开启，还剩 {days} 天",
  },
  "tier.deepLocked": {
    en: "Deep mode is a sponsor feature",
    zh: "深度模式是赞助者专属功能",
  },
  "tier.unlimitedSearchLocked": {
    en: "Unlimited search is a sponsor feature",
    zh: "无限搜索是赞助者专属功能",
  },

  // ── Email draft ──
  "email.copyEmail": { en: "Copy Email", zh: "复制邮件" },
  "email.copied": { en: "Copied!", zh: "已复制！" },
  "email.openMail": { en: "Open in Mail", zh: "打开邮件" },

  // ── Image annotator ──
  "annotate.title": { en: "Mark the area", zh: "标记区域" },
  "annotate.clear": { en: "Clear", zh: "清除" },
  "annotate.done": { en: "Done", zh: "完成" },
  "annotate.skip": { en: "Skip", zh: "跳过" },

  // ── Invite ──
  "invite.title": { en: "Invite Only", zh: "邻里专属" },
  "invite.subtitle": {
    en: "greatneck.ai is currently available by invitation only.",
    zh: "目前仅限受邀的大颈小伙伴使用哦~",
  },
  "invite.placeholder": { en: "Enter invite code", zh: "粘贴邀请码" },
  "invite.enter": { en: "Enter", zh: "进入" },
  "invite.invalid": { en: "Invalid invite code", zh: "邀请码不对哦，再看看？" },
  "invite.used": { en: "This invite code has already been used", zh: "这个码已经被用过啦" },
  "invite.needInvite": {
    en: "Have an invite code? Enter it above. Or ask a member to share one with you.",
    zh: "有码直接输入~ 没有的话找邻居要一个吧！",
  },
  "invite.alreadyMember": { en: "Already a member? Sign in", zh: "已经是老用户了？直接登录" },
  "invite.generate": { en: "Generate Invite", zh: "生成邀请码" },
  "invite.remaining": { en: "{n} of {total} remaining", zh: "还剩 {n}/{total} 个" },
  "invite.unlimited": { en: "Unlimited", zh: "不限量" },
  "invite.copied": { en: "Copied!", zh: "已复制！" },
  "invite.friends": { en: "Invite Friends", zh: "邀请邻居" },
  "invite.available": { en: "Available", zh: "可用" },
  "invite.redeemed": { en: "Used", zh: "已使用" },
  "invite.shareNeighbors": { en: "Share with neighbors!", zh: "分享给邻居！" },
  "invite.copyCode": { en: "Copy Code", zh: "复制邀请码" },
  "invite.copyLink": { en: "Copy Link", zh: "复制链接" },
  "invite.share": { en: "Share", zh: "分享" },
  "invite.shareText": {
    en: "Join me on greatneck.ai — your AI community assistant for Great Neck! Use invite code: {code}",
    zh: "来试试 greatneck.ai 吧！大颈社区AI助手，邀请码：{code}",
  },
  "invite.noInvites": { en: "No invites yet", zh: "还没有邀请码" },

  // ── Waitlist ──
  "waitlist.join": { en: "Join the Waitlist", zh: "加入候补名单" },
  "waitlist.description": {
    en: "No invite code? Leave your email and we'll notify you when a spot opens up.",
    zh: "没有邀请码？留下邮箱，有名额时我们会通知你。",
  },
  "waitlist.emailPlaceholder": { en: "your@email.com", zh: "your@email.com" },
  "waitlist.namePlaceholder": { en: "Your name (optional)", zh: "你的名字（选填）" },
  "waitlist.submit": { en: "Join Waitlist", zh: "加入候补" },
  "waitlist.success": {
    en: "You're on the list! We'll reach out when a spot opens.",
    zh: "你已加入候补名单！有名额时我们会联系你。",
  },
  "waitlist.error": { en: "Please enter a valid email", zh: "请输入有效的邮箱" },
  "waitlist.back": { en: "Back", zh: "返回" },

  // ── Pipeline ──
  "pipeline.researching": { en: "Researching...", zh: "正在搜索..." },
  "pipeline.thinking": { en: "Thinking...", zh: "思考中..." },
  "pipeline.researched": {
    en: "Researched in {steps} steps, {searches} searches",
    zh: "共 {steps} 个步骤、{searches} 次搜索",
  },
  "pipeline.thought": {
    en: "Thought through {steps} steps",
    zh: "经过 {steps} 个步骤的思考",
  },
  "pipeline.foundResults": { en: "found results", zh: "找到结果" },
  "pipeline.noResults": { en: "no results", zh: "无结果" },

  // ── Playbooks (攻略) ──
  "guides.title": { en: "My Playbooks", zh: "我的攻略" },
  "guides.subtitle": { en: "Your step-by-step plans for life in Great Neck", zh: "大颈生活，一步一步搞定" },
  "guides.tab.wallet": { en: "Mine", zh: "我的" },
  "guides.tab.browse": { en: "Explore", zh: "发现" },
  "guides.empty": { en: "No playbooks yet", zh: "还没有攻略" },
  "guides.browseCta": { en: "Find one that fits your life →", zh: "看看有什么适合你的 →" },
  "guides.steps": { en: "steps", zh: "步" },
  "guides.priority": { en: "Do this first", zh: "先做这个" },
  "guides.reminder": { en: "Reminder set", zh: "已设提醒" },
  "guides.undo": { en: "Undo", zh: "撤销" },
  "guides.save": { en: "Save", zh: "保存" },
  "guides.notePlaceholder": { en: "Jot something down...", zh: "随手记一下..." },
  "guides.tapHint": { en: "Tap any step to learn more", zh: "点一步看详情" },
  "guides.backToWallet": { en: "Back to my playbooks", zh: "返回我的攻略" },
  "guides.removeFromWallet": { en: "Remove this playbook", zh: "移除这个攻略" },
  "guides.backHome": { en: "← Back to home", zh: "← 返回首页" },
  "guides.teaserTitle": { en: "Playbooks", zh: "攻略" },
  "guides.viewAll": { en: "See all", zh: "查看全部" },
  "nav.guides": { en: "Playbooks", zh: "攻略" },

  // Status control
  "guides.status.todo": { en: "To Do", zh: "待办" },
  "guides.status.inProgress": { en: "Working on it", zh: "进行中" },
  "guides.status.done": { en: "Done", zh: "完成" },
  "guides.status.skipped": { en: "Not for me", zh: "不适用" },

  // Secondary actions
  "guides.action.remind": { en: "Remind", zh: "提醒" },
  "guides.action.note": { en: "Note", zh: "备注" },
  "guides.action.askAI": { en: "Ask AI", zh: "问 AI" },

  // Peek sheet
  "guides.peek.addToMine": { en: "Add to Mine", zh: "加入我的" },
  "guides.peek.alreadySaved": { en: "Already saved", zh: "已保存" },
  "guides.peek.moreSteps": { en: "more steps", zh: "更多步骤" },
  "guides.peek.stepsPreview": { en: "What's inside", zh: "内容预览" },

  // Inline chat
  "guides.chat.title": { en: "Quick Answer", zh: "快速回答" },
  "guides.chat.loading": { en: "Thinking...", zh: "思考中..." },
  "guides.chat.error": { en: "Couldn't load answer. Tap to retry.", zh: "未能加载，点击重试" },
  "guides.chat.continue": { en: "Continue in full chat →", zh: "去对话详聊 →" },
  "guides.chat.placeholder": { en: "Ask a quick question about this step...", zh: "关于这一步有什么问题？" },
  "guides.chat.inputPlaceholder": { en: "Type a question...", zh: "输入问题..." },
  "guides.chat.backToPlaybook": { en: "Back to playbook", zh: "返回攻略" },

  // Custom playbooks (create / edit / fork)
  "guides.create": { en: "Create Playbook", zh: "创建攻略" },
  "guides.create.prompt": { en: "What playbook do you want to create?", zh: "你想创建什么攻略？" },
  "guides.create.placeholder": { en: "Describe your goal...", zh: "描述你的目标..." },
  "guides.create.generating": { en: "Creating your playbook...", zh: "正在创建你的攻略..." },
  "guides.create.refine": { en: "Want to change something?", zh: "想修改什么？" },
  "guides.create.refine.placeholder": { en: "e.g. Add a step about finding a contractor", zh: "例如：添加一个关于找承包商的步骤" },
  "guides.create.save": { en: "Save to My Playbooks", zh: "保存到我的攻略" },
  "guides.create.startOver": { en: "Start Over", zh: "重新开始" },
  "guides.edit": { en: "Edit", zh: "编辑" },
  "guides.edit.addStep": { en: "Add Step", zh: "添加步骤" },
  "guides.edit.deleteStep": { en: "Delete Step", zh: "删除步骤" },
  "guides.edit.saved": { en: "Saved", zh: "已保存" },
  "guides.edit.done": { en: "Done", zh: "完成" },
  "guides.fork": { en: "Make it mine", zh: "复制到我的" },
  "guides.fork.description": { en: "Create your own editable copy", zh: "创建你自己的可编辑副本" },
  "guides.custom": { en: "Custom", zh: "自定义" },
  "guides.community": { en: "Community", zh: "社区" },
  "guides.publish": { en: "Publish", zh: "发布" },
  "guides.unpublish": { en: "Unpublish", zh: "取消发布" },
  "guides.delete": { en: "Delete", zh: "删除" },
  "guides.delete.confirm": { en: "Delete this playbook?", zh: "删除这个攻略？" },
  "guides.save.cta": { en: "Save to My Playbooks", zh: "保存到我的攻略" },
  "guides.save.headline": { en: "Make it yours", zh: "变成你的" },
  "guides.save.description": { en: "Get your own private copy — only you can see it.", zh: "获取你的私人副本——只有你能看到。" },
  "guides.save.bullet.notes": { en: "Add personal notes to any step", zh: "在任何步骤添加个人笔记" },
  "guides.save.bullet.reminders": { en: "Set reminders so you don't forget", zh: "设置提醒以免遗忘" },
  "guides.save.bullet.track": { en: "Check off steps at your own pace", zh: "按自己的节奏勾选步骤" },
  "guides.private.badge": { en: "Private", zh: "私密" },
  "guides.private.hint": { en: "Only you can see this playbook. Your notes & reminders stay private.", zh: "只有你能看到这个攻略。你的笔记和提醒保持私密。" },
  "guides.publish.confirm.title": { en: "Publish this playbook?", zh: "发布这个攻略？" },
  "guides.publish.confirm.description": { en: "Once published, your playbook becomes visible to everyone in the community.", zh: "发布后，你的攻略将对社区所有人可见。" },
  "guides.publish.confirm.shared": { en: "Steps, titles, and descriptions will be shared", zh: "步骤、标题和描述将被分享" },
  "guides.publish.confirm.noNotes": { en: "Your personal notes & reminders stay private", zh: "你的个人笔记和提醒保持私密" },
  "guides.publish.confirm.interact": { en: "Others can like, comment, and fork your playbook", zh: "他人可以点赞、评论和复制你的攻略" },
  "guides.publish.confirm.ok": { en: "Publish", zh: "发布" },
  "guides.publish.confirm.cancel": { en: "Keep Private", zh: "保持私密" },
  "guides.unpublish.confirm.title": { en: "Unpublish this playbook?", zh: "取消发布这个攻略？" },
  "guides.unpublish.confirm.description": { en: "It will no longer appear in Explore. Existing likes and comments will be preserved.", zh: "它将不再出现在探索中。现有的点赞和评论将被保留。" },
  "guides.unpublish.confirm.ok": { en: "Unpublish", zh: "取消发布" },
  "guides.unpublish.confirm.cancel": { en: "Keep Published", zh: "保持发布" },

  // Landing page playbooks section
  "landing.playbooks.title": { en: "Your Playbooks", zh: "你的攻略" },
  "landing.playbooks.seeAll": { en: "See all", zh: "查看全部" },
  "landing.playbooks.create": { en: "Create your own", zh: "创建你自己的" },
  "landing.playbooks.subtitleMine": { en: "Your cheat sheets for surviving (and thriving in) Great Neck.", zh: "你的大颈生存（和发展）小抄。" },
  "landing.playbooks.subtitleExplore": { en: "Step-by-step cheat sheets for everything from dog walks to school drop-off. Grab one.", zh: "从遛狗到接送上学，一步步的生存指南。拿一个吧。" },
};

export default translations;
