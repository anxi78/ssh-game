/**
 * 游戏逻辑：一个「修好快乐服务」的终端小游戏
 * ==========================================
 * 玩法参考 happy1024.cn 的思路，但内容和文案都是原创的。
 *
 * 核心机制：
 *   · 假文件系统（ls / cat）
 *   · 假进程列表（ps / kill）
 *   · 状态机（repair / restart）
 *   · 彩蛋（sl / vim / sudo 等）
 */

'use strict';

const BANNER = `
   █████╗ ███╗   ██╗██╗  ██╗██╗
  ██╔══██╗████╗  ██║╚██╗██╔╝██║
  ███████║██╔██╗ ██║ ╚███╔╝ ██║
  ██╔══██║██║╚██╗██║ ██╔██╗ ██║
  ██║  ██║██║ ╚████║██╔╝ ██╗██║
  ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝

            s s h   g a m e
`;

const HELP_TEXT = `ANXI SSH GAME · 命令列表

  基础
    help        看这份帮助
    status      查看服务状态
    ls          看当前目录有什么
    cat <文件>  读文件内容
    ps          看进程列表
    clear       清屏
    exit        退出

  主线
    repair      修东西（repair mood / repair focus / repair sleep）
    restart     重启服务（需要先修好）
    logs        看日志

  其他
    whoami      你是谁
    egg         彩蛋手账
    about       关于这个游戏
`;

const FILES = {
  'note.txt': `[工作日志]
今天又加班到十一点。
写完了三个需求，改了两个 bug，
然后发现第三个 bug 是自己昨天写的。

……先睡觉吧。`,

  'todo.txt': `[ ] 给 mood.sh 一点执行权限：repair mood
[ ] 找回一点专注：repair focus
[ ] 今天不熬到十二点以后`,

  'mood.log': `[ERROR] /opt/life/mood.sh: Permission denied
[ WARN] FOCUS_LEVEL=0；检测到连续加班，未检测到休息。
[DEBUG] 今天的会议：讨论为什么会有这么多会。
修复提示：repair mood / repair focus`,

  '.bashrc': `# 别删我，删了我也不会真的坏（这是游戏）
alias ll='ls -l'
alias ..='cd ..'
# 提示：试试把 ls 打成 sl`,
};

const PROCS = [
  { pid: 1024, name: 'meetingd', desc: '正在发送第 1025 个会议邀请' },
  { pid: 404, name: 'mood.sh', desc: '尚未获得执行权限' },
  { pid: 2048, name: 'focusd', desc: '在后台游荡' },
  { pid: 1, name: 'systemd', desc: '假装很忙' },
];

const EGGS = [
  { id: 'meeting', name: '会议终结者', hint: '让 meetingd 正常下班' },
  { id: 'vim', name: 'Vim 生还者', hint: '从虚拟编辑器里平安退出' },
  { id: 'sl', name: '误入铁道', hint: '手滑把 ls 打成 sl' },
  { id: 'sudo', name: '不需要 root', hint: '发现有些事不需要 sudo' },
  { id: 'restart', name: '亲手重启', hint: '修好一切然后 restart' },
  { id: 'fish', name: '工位水族馆', hint: '在工位摸一会儿鱼' },
];

class GameSession {
  constructor(stream, client) {
    this.stream = stream;
    this.client = client;
    this.buffer = '';
    this.closed = false;

    this.state = {
      meetingKilled: false,
      moodFixed: false,
      focusFixed: false,
      sleepRestored: false,
      restarted: false,
      inVim: false,
      eggs: new Set(),
      userName: 'guest',
      startedAt: Date.now(),
    };

    stream.on('data', (chunk) => this.onData(chunk));
    stream.on('close', () => this.onClose());
    stream.on('error', () => this.onClose());

    // 窗口尺寸变化时重绘提示符
    stream.on('resize', () => {});
  }

  start() {
    this.write(BANNER);
    this.write('\n欢迎来到 ANXI SSH GAME\n');
    this.write('这里没有真实 shell，只有一点点小游戏。\n');
    this.write('输入 help 看看能做什么，exit 退出。\n\n');
    this.prompt();
  }

  onClose() {
    if (this.closed) return;
    this.closed = true;
    try { this.stream.end(); } catch {}
    try { this.client.end(); } catch {}
  }

  write(text) {
    if (this.closed) return;
    try { this.stream.write(text); } catch { this.onClose(); }
  }

  prompt() {
    this.write('guest@anxi:~$ ');
  }

  onData(chunk) {
    if (this.closed) return;
    const text = chunk.toString('utf8');

    for (const ch of text) {
      // Ctrl+C / Ctrl+D
      if (ch === '\x03' || ch === '\x04') {
        this.write('\r\nbye~\r\n');
        this.onClose();
        return;
      }

      // 退格
      if (ch === '\x7f' || ch === '\b') {
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.slice(0, -1);
          // 擦掉终端上的一个字符
          this.write('\b \b');
        }
        continue;
      }

      // 回车
      if (ch === '\r' || ch === '\n') {
        this.write('\r\n');
        const line = this.buffer.trim();
        this.buffer = '';
        this.handleLine(line);
        return;
      }

      // 可打印字符
      if (ch >= ' ' && ch !== '\x7f') {
        this.buffer += ch;
        this.write(ch); // 回显
      }
    }
  }

  handleLine(line) {
    if (this.closed) return;

    // 虚拟 vim 模式：只认 :q
    if (this.state.inVim) {
      if (line === ':q' || line === ':q!') {
        this.state.inVim = false;
        this.write('你平安退出了虚拟 Vim。今天又少了一个千古难题。\n');
        this.unlock('vim');
        this.prompt();
        return;
      }
      this.write('E492: 这里是虚拟 Vim。输入 :q 就能回去。\n');
      this.prompt();
      return;
    }

    if (!line) {
      this.prompt();
      return;
    }

    const [cmd, ...args] = line.split(/\s+/);
    const arg = args.join(' ');

    switch (cmd.toLowerCase()) {
      case 'help': return this.cmdHelp();
      case 'status': return this.cmdStatus();
      case 'ls': return this.cmdLs();
      case 'll': return this.cmdLs();
      case 'cat': return this.cmdCat(arg);
      case 'ps': return this.cmdPs();
      case 'kill': return this.cmdKill(arg);
      case 'repair': return this.cmdRepair(arg);
      case 'restart': return this.cmdRestart();
      case 'logs':
      case 'journalctl': return this.cmdLogs();
      case 'clear': return this.cmdClear();
      case 'whoami': return this.cmdWhoami();
      case 'egg':
      case 'eggs':
      case 'achievements': return this.cmdEggs();
      case 'about': return this.cmdAbout();
      case 'exit':
      case 'quit':
      case 'logout':
        this.write('bye~\n');
        return this.onClose();

      // repair focus 之后的补给选项
      case 'sleep': return this.cmdSleep();
      case 'coffee': return this.cmdCoffee();

      // 彩蛋
      case 'sl': return this.cmdSl();
      case 'vim':
      case 'vi': return this.cmdVim();
      case 'sudo': return this.cmdSudo();
      case 'fish': return this.cmdFish();
      case 'work': return this.cmdWork();
      case 'echo': return this.cmdEcho(arg);

      default:
        this.write(`command not found: ${cmd}\n`);
        // 给个善意的提示
        if (cmd.length > 2) {
          this.write(`也许你想输入 help？\n`);
        }
        this.prompt();
    }
  }

  // ── 命令实现 ──

  cmdHelp() {
    this.write(HELP_TEXT + '\n');
    this.prompt();
  }

  cmdStatus() {
    const mood = this.state.moodFixed ? 'OK' : 'Permission denied';
    const focus = this.state.focusFixed ? 'OK' : '0 / 1024';
    this.write(`happiness.service: ${this.state.restarted ? 'active (running)' : 'failed'}\n`);
    this.write(`mood.sh:  ${mood}\n`);
    this.write(`focus:    ${focus}\n`);
    this.write(`meetingd: ${this.state.meetingKilled ? '已下班' : '仍在邀请你'}\n`);
    if (!this.state.restarted) {
      this.write('\n提示：先 repair，再 restart。\n');
    }
    this.prompt();
  }

  cmdLs() {
    const items = Object.keys(FILES);
    this.write(items.join('    ') + '\n');
    this.prompt();
  }

  cmdCat(name) {
    if (!name) {
      this.write('用法: cat <文件名>\n');
      return this.prompt();
    }
    const key = name.replace(/^\.\//, '');
    const content = FILES[key];
    if (!content) {
      this.write(`cat: ${name}: No such file\n`);
      return this.prompt();
    }
    this.write(content + '\n\n');
    this.prompt();
  }

  cmdPs() {
    this.write(' PID   进程         状态\n');
    for (const p of PROCS) {
      if (p.name === 'meetingd' && this.state.meetingKilled) continue;
      this.write(` ${String(p.pid).padStart(4)}  ${p.name.padEnd(12)} ${p.desc}\n`);
    }
    if (!this.state.meetingKilled) {
      this.write('\n想让会议结束？试试 kill meetingd。\n');
    }
    this.prompt();
  }

  cmdKill(target) {
    if (!target) {
      this.write('用法: kill <进程名>\n');
      return this.prompt();
    }
    if (target === 'meetingd') {
      if (this.state.meetingKilled) {
        this.write('meetingd 已经不在了。\n');
      } else {
        this.state.meetingKilled = true;
        this.write('meetingd 收到下班信号，准备最后说两句……\n');
        this.write('你替它点了「结束会议」。它终于没有再说两句。\n');
        this.unlock('meeting');
      }
      return this.prompt();
    }
    if (target === 'mood.sh' || target === 'focusd') {
      this.write(`${target} 不是能 kill 掉的东西，试试 repair。\n`);
      return this.prompt();
    }
    this.write(`kill: ${target}: no such process\n`);
    this.prompt();
  }

  cmdRepair(what) {
    if (!what) {
      this.write('用法: repair <mood|focus|sleep>\n');
      return this.prompt();
    }
    if (what === 'mood') {
      if (this.state.moodFixed) {
        this.write('mood.sh 已经是 executable 了。\n');
      } else {
        this.state.moodFixed = true;
        this.write('正在尝试让 mood.sh 自己给自己授权……失败。它说得你来。\n');
        this.write('维护员签名已收到。mood.sh：好，那我先笑一个 :)\n');
        this.write('mood.sh: executable。今天的快乐，已经获得执行权限。\n');
      }
      return this.prompt();
    }
    if (what === 'focus') {
      if (this.state.focusFixed) {
        this.write('focus 已经是满的了。\n');
      } else {
        this.write('专注力不能硬修，但能换个办法补回来。\n');
        this.write('  选一个：\n');
        this.write('    sleep   好好睡一觉，直接充满\n');
        this.write('    coffee  喝杯咖啡，+512\n');
        this.write('    fish    在工位摸一会儿鱼，可能有意外来客\n');
        this.write('  （直接输入 sleep / coffee / fish）\n');
      }
      return this.prompt();
    }
    if (what === 'sleep') {
      return this.cmdSleep();
    }
    this.write(`repair: 不认识 ${what}。可选项：mood / focus / sleep\n`);
    this.prompt();
  }

  cmdSleep() {
    if (this.state.focusFixed) {
      this.write('你刚睡醒，还不想再睡。\n');
      return this.prompt();
    }
    this.state.focusFixed = true;
    this.state.sleepRestored = true;
    this.write('收到，你休息，我值班。\n');
    this.write('  z Z z   [已关闭：工作群提醒]\n');
    this.write('醒来后发现：世界没有崩，服务也没有少。\n');
    this.write('FOCUS_LEVEL: 0 → 1024 / 1024\n');
    this.write('专注已充满。输入 restart，看看这次会发生什么。\n');
    this.prompt();
  }

  cmdCoffee() {
    if (this.state.focusFixed) {
      this.write('你已经很清醒了。\n');
      return this.prompt();
    }
    this.state.focusFixed = true;
    this.write('咖啡机：正在把 512 份专注压进杯子里……叮。\n');
    this.write('FOCUS_LEVEL: 0 → 512 / 1024\n');
    this.write('还差一半。再来一杯 coffee，或者换 sleep。\n');
    this.prompt();
  }

  cmdRestart() {
    if (!this.state.moodFixed || !this.state.focusFixed) {
      this.write('还不能重启。请先完成：\n');
      if (!this.state.moodFixed) this.write('  repair mood\n');
      if (!this.state.focusFixed) this.write('  repair focus（然后选 sleep / coffee / fish）\n');
      return this.prompt();
    }
    if (this.state.restarted) {
      this.write('已经重启过了，服务正跑得好好的。\n');
      return this.prompt();
    }
    this.state.restarted = true;
    this.write('mood.sh    [ OK ]  :D\n');
    this.write('meetingd   [SKIP]  已取消「关于效率的复盘会」\n');
    this.write('weekend    [ OK ]  已为你保留\n');
    this.write('\n[ OK ] happiness.service: active (running)\n');
    this.write('这次修好的，好像不只是服务。\n');
    this.write('\n祝你今天过得还行。\n');
    this.unlock('restart');
    this.prompt();
  }

  cmdLogs() {
    this.write(FILES['mood.log'] + '\n\n');
    this.prompt();
  }

  cmdClear() {
    this.write('\x1b[2J\x1b[H');
    this.prompt();
  }

  cmdWhoami() {
    this.write(`guest（这是一个游戏，不是真 shell）\n`);
    this.write(`在线时长: ${Math.floor((Date.now() - this.state.startedAt) / 1000)} 秒\n`);
    this.prompt();
  }

  cmdEggs() {
    const found = this.state.eggs.size;
    this.write(`彩蛋手账 ${found} / ${EGGS.length}\n\n`);
    for (const egg of EGGS) {
      const got = this.state.eggs.has(egg.id);
      this.write(`  [${got ? '✓' : ' '}] ${got ? egg.name : '???'}${got ? '' : `  · ${egg.hint}`}\n`);
    }
    this.write('\n');
    this.prompt();
  }

  cmdAbout() {
    this.write('ANXI SSH GAME v1.0\n');
    this.write('一个跑在 SSH 上的终端小游戏。\n');
    this.write('没有真实 shell，所有命令都是假的。\n');
    this.write('随便玩，不用怕弄坏什么。\n\n');
    this.prompt();
  }

  // ── 彩蛋 ──

  cmdSl() {
    this.write('   __   __   __\n');
    this.write(' _|__|_|__|_|__|_\n');
    this.write('  O-O   O-O   O-O   →\n');
    this.write('你把 ls 打成了 sl，一列下班专车从终端开过。\n');
    this.unlock('sl');
    this.prompt();
  }

  cmdVim() {
    this.state.inVim = true;
    this.write('~  致：今年辛苦的自己\n');
    this.write('~  今天的快乐，不需要等到需求做完。\n');
    this.write('~\n');
    this.write('"note.txt" [虚拟编辑器]\n');
    this.write('提示：输入 :q 可以回去。\n');
  }

  cmdSudo() {
    this.write('command not found。\n');
    this.write('（这里没有 sudo。你本来也不需要它。）\n');
    this.unlock('sudo');
    this.prompt();
  }

  cmdFish() {
    this.write('  ><(((°>    ><(((°>    工位水族馆已启动。\n');
    this.write('[接近提示] 老板的脚步声越来越近……\n');
    this.write('work 假装工作 / fish 继续摸鱼。你选哪个？\n');
    this.unlock('fish');
    this.prompt();
  }

  cmdWork() {
    this.write('你熟练地切到了编辑器。老板点点头：「辛苦了，早点下班。」\n');
    this.write('鱼被妥善安置在后台，没有一条连接受到伤害。\n');
    if (!this.state.focusFixed) {
      this.state.focusFixed = true;
      this.write('FOCUS_LEVEL: 0 → 1024 / 1024\n');
      this.write('专注已充满。输入 restart，看看这次会发生什么。\n');
    }
    this.prompt();
  }

  cmdEcho(text) {
    this.write((text || '') + '\n');
    this.prompt();
  }

  // ── 工具 ──

  unlock(id) {
    if (this.state.eggs.has(id)) return;
    this.state.eggs.add(id);
    const egg = EGGS.find((e) => e.id === id);
    this.write(`\n★ 彩蛋发现：${egg ? egg.name : id} [${this.state.eggs.size}/${EGGS.length}]\n`);
  }
}

module.exports = { GameSession };
