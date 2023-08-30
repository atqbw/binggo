import { fetch, WebSocket, debug } from '@/lib/isomorphic'
import WebSocketAsPromised from 'websocket-as-promised'
import {
  SendMessageParams,
  BingConversationStyle,
  ConversationResponse,
  ChatResponseMessage,
  ConversationInfo,
  InvocationEventType,
  ChatError,
  ErrorCode,
  ChatUpdateCompleteResponse,
  ImageInfo,
  KBlobResponse,
  ConversationInfoBase
} from './types'

import { convertMessageToMarkdown, websocketUtils, streamAsyncIterable } from './utils'
import { createChunkDecoder } from '@/lib/utils'

type Params = SendMessageParams<{ bingConversationStyle: BingConversationStyle, conversation: Partial<ConversationInfoBase> }>

const getOptionSets = (conversationStyle: BingConversationStyle) => {
  return {
    [BingConversationStyle.Creative]: [
      'nlu_direct_response_filter',
      'deepleo',
      'disable_emoji_spoken_text',
      'responsible_ai_policy_235',
      'enablemm',
      'dv3sugg',
      'autosave',
      'iyxapbing',
      'iycapbing',
      'h3imaginative',
      'cpcandi',
      'cpcatral6',
      'cpcatro50',
      'cpcfmql',
      'cpcgnddi',
      'cpcmattr2',
      'cpcmcit2',
      'e2ecacheread',
      'nocitpass',
      'logprobsc',
      'log2sph',
      'fpsports',
      'rctechalwlst',
      'agicert',
      'eredirecturl',
      'clgalileo',
      'gencontentv3'
    ],
    [BingConversationStyle.Balanced]: [
      'nlu_direct_response_filter',
      'deepleo',
      'disable_emoji_spoken_text',
      'responsible_ai_policy_235',
      'enablemm',
      'dv3sugg',
      'autosave',
      'iyxapbing',
      'iycapbing',
      'galileo',
      'saharagenconv5',
      'cgptreasondl',
      'fluxclmodelsp',
      'fluxhint',
      'glfluxv13',
      'cpcandi',
      'cpcatral6',
      'cpcatro50',
      'cpcfmql',
      'cpcgnddi',
      'cpcmattr2',
      'cpcmcit2',
      'e2ecacheread',
      'nocitpass',
      'logprobsc',
      'log2sph',
      'fpsports',
      'rctechalwlst',
      'agicert',
      'eredirecturl'
    ],
    [BingConversationStyle.Precise]: [
      'nlu_direct_response_filter',
      'deepleo',
      'disable_emoji_spoken_text',
      'responsible_ai_policy_235',
      'enablemm',
      'dv3sugg',
      'autosave',
      'iyxapbing',
      'iycapbing',
      'h3precise',
      'clgalileo',
      'gencontentv3',
      'cpcandi',
      'cpcatral6',
      'cpcatro50',
      'cpcfmql',
      'cpcgnddi',
      'cpcmattr2',
      'cpcmcit2',
      'e2ecacheread',
      'nocitpass',
      'logprobsc',
      'log2sph',
      'fpsports',
      'rctechalwlst',
      'agicert',
      'eredirecturl'
    ]
  }[conversationStyle]
}

export class BingWebBot {
  protected conversationContext?: ConversationInfo
  protected cookie: string
  protected ua: string
  protected endpoint = ''
  private lastText = ''
  private asyncTasks: Array<Promise<any>> = []

  constructor(opts: {
    cookie: string
    ua: string
    bingConversationStyle?: BingConversationStyle
    conversationContext?: ConversationInfo
  }) {
    const { cookie, ua, conversationContext } = opts
    this.cookie = cookie?.includes(';') ? cookie : `_EDGE_V=1; _U=${cookie}`
    this.ua = ua
    this.conversationContext = conversationContext
  }

  static buildChatRequest(conversation: ConversationInfo) {
    return {
      arguments: [
        {
          source: 'cib',
          optionsSets: getOptionSets(conversation.conversationStyle),
          allowedMessageTypes: [
            'ActionRequest',
            'Chat',
            'Context',
            'InternalSearchQuery',
            'InternalSearchResult',
            'Disengaged',
            'InternalLoaderMessage',
            'Progress',
            'RenderCardRequest',
            'SemanticSerp',
            'GenerateContentQuery',
            'SearchQuery',
          ],
          sliceIds: [
            'divkorbl2p',
            'crtrgxnew',
            'wrapuxslimt',
            'wrapnoins',
            'suppsm-c',
            'sydconfigoptc',
            '0824cntors0',
            '713logprobsc',
            '803iyjbexps0',
            '806log2sph',
            '804sprts0',
            '178gentech',
            '824fluxhi52',
            '0825agicert',
            '804cdxedtgds0',
            '821iypapyrusc',
            '727nrprdrt3'
          ],
          isStartOfSession: conversation.invocationId === 0,
          message: {
            author: 'user',
            inputMethod: 'Keyboard',
            text: conversation.prompt,
            imageUrl: conversation.imageUrl,
            messageType: 'Chat',
          },
          conversationId: conversation.conversationId,
          conversationSignature: conversation.conversationSignature,
          participant: { id: conversation.clientId },
        },
      ],
      invocationId: conversation.invocationId.toString(),
      target: 'chat',
      type: InvocationEventType.StreamInvocation,
    }
  }

  async createConversation(conversationId?: string): Promise<ConversationResponse> {
    const headers = {
      'Accept-Encoding': 'gzip, deflate, br, zsdch',
      'User-Agent': this.ua,
      'x-ms-useragent': 'azsdk-js-api-client-factory/1.0.0-beta.1 core-rest-pipeline/1.10.0 OS/Win32',
      cookie: this.cookie,
    }

    let resp: ConversationResponse | undefined
    try {
      const search = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''
      const response = await fetch(`${this.endpoint}/api/create${search}`, { method: 'POST', headers, redirect: 'error', mode: 'cors', credentials: 'include' })
      if (response.status === 404) {
        throw new ChatError('Not Found', ErrorCode.NOTFOUND_ERROR)
      }
      resp = await response.json() as ConversationResponse
    } catch (err) {
      console.error('create conversation error', err)
    }

    if (!resp?.result) {
      throw new ChatError('你的 VPS 或代理可能被封禁，如有疑问，请前往 https://github.com/weaigc/bingo 咨询', ErrorCode.BING_IP_FORBIDDEN)
    }

    const { value, message } = resp.result || {}
    if (value !== 'Success') {
      const errorMsg = `${value}: ${message}`
      if (value === 'UnauthorizedRequest') {
        if (/fetch failed/i.test(message || '')) {
          throw new ChatError(errorMsg, ErrorCode.BING_IP_FORBIDDEN)
        }
        throw new ChatError(errorMsg, ErrorCode.BING_UNAUTHORIZED)
      }
      if (value === 'TryLater') {
        throw new ChatError(errorMsg, ErrorCode.BING_TRY_LATER)
      }
      if (value === 'Forbidden') {
        throw new ChatError(errorMsg, ErrorCode.BING_FORBIDDEN)
      }
      throw new ChatError(errorMsg, ErrorCode.UNKOWN_ERROR)
    }
    return resp
  }

  private async createContext(conversationStyle: BingConversationStyle, conversation?: ConversationInfoBase) {
    if (!this.conversationContext) {
      conversation = conversation?.conversationSignature ? conversation : await this.createConversation() as unknown as ConversationInfo
      this.conversationContext = {
        conversationId: conversation.conversationId,
        conversationSignature: conversation.conversationSignature,
        clientId: conversation.clientId,
        invocationId: conversation.invocationId ?? 0,
        conversationStyle,
        prompt: '',
      }
    }
    return this.conversationContext
  }

  async sendMessage(params: Params) {
    try {
      await this.createContext(params.options.bingConversationStyle, params.options.conversation as ConversationInfoBase)
      Object.assign(this.conversationContext!, { prompt: params.prompt, imageUrl: params.imageUrl })
      return this.sydneyProxy(params)
    } catch (error) {
      params.onEvent({
        type: 'ERROR',
        error: error instanceof ChatError ? error : new ChatError('Catch Error', ErrorCode.UNKOWN_ERROR),
      })
    }
  }

  private async sydneyProxy(params: Params) {
    this.lastText = ''
    const abortController = new AbortController()
    const response = await fetch(this.endpoint + '/api/sydney', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: abortController.signal,
      body: JSON.stringify(this.conversationContext!)
    })
    if (response.status !== 200) {
      params.onEvent({
        type: 'ERROR',
        error: new ChatError(
          'Unknown error',
          ErrorCode.UNKOWN_ERROR,
        ),
      })
    }
    params.signal?.addEventListener('abort', () => {
      abortController.abort()
    })

    const textDecoder = createChunkDecoder()
    for await (const chunk of streamAsyncIterable(response.body!)) {
      this.parseEvents(params, websocketUtils.unpackMessage(textDecoder(chunk)))
    }
  }

  async sendWs() {
    const wsConfig: ConstructorParameters<typeof WebSocketAsPromised>[1] = {
      packMessage: websocketUtils.packMessage,
      unpackMessage: websocketUtils.unpackMessage,
      createWebSocket: (url) => new WebSocket(url, {
        headers: {
          'accept-language': 'zh-CN,zh;q=0.9',
          'cache-control': 'no-cache',
          'User-Agent': this.ua,
          pragma: 'no-cache',
          cookie: this.cookie,
        }
      })
    }
    const wsp = new WebSocketAsPromised('wss://sydney.bing.com/sydney/ChatHub', wsConfig)

    wsp.open().then(() => {
      wsp.sendPacked({ protocol: 'json', version: 1 })
      wsp.sendPacked({ type: 6 })
      wsp.sendPacked(BingWebBot.buildChatRequest(this.conversationContext!))
    })

    return wsp
  }

  private async createImage(prompt: string, id: string) {
    const headers = {
      'Accept-Encoding': 'gzip, deflate, br, zsdch',
      'User-Agent': this.ua,
      'x-ms-useragent': 'azsdk-js-api-client-factory/1.0.0-beta.1 core-rest-pipeline/1.10.0 OS/Win32',
      cookie: this.cookie,
    }
    const query = new URLSearchParams({
      prompt,
      id
    })
    const response = await fetch(this.endpoint + '/api/image?' + query.toString(),
      {
        method: 'POST',
        headers,
        mode: 'cors',
        credentials: 'include'
      })
      .then(async (response) => {
        if (response.status == 200) {
          return response.text();
        } else {
          throw new ChatError(String(await response.text()), ErrorCode.BING_IMAGE_UNAUTHORIZED)
        }
      })

    if (response) {
      this.lastText += '\n' + response
    }
  }

  private buildKnowledgeApiPayload(imageUrl: string, conversationStyle: BingConversationStyle) {
    const imageInfo: ImageInfo = {}
    let imageBase64: string | undefined = undefined
    const knowledgeRequest = {
      imageInfo,
      knowledgeRequest: {
        invokedSkills: [
          'ImageById'
        ],
        subscriptionId: 'Bing.Chat.Multimodal',
        invokedSkillsRequestData: {
          enableFaceBlur: true
        },
        convoData: {
          convoid: this.conversationContext?.conversationId,
          convotone: conversationStyle,
        }
      },
    }

    if (imageUrl.startsWith('data:image/')) {
      imageBase64 = imageUrl.replace('data:image/', '');
      const partIndex = imageBase64.indexOf(',')
      if (partIndex) {
        imageBase64 = imageBase64.substring(partIndex + 1)
      }
    } else {
      imageInfo.url = imageUrl
    }
    return { knowledgeRequest, imageBase64 }
  }

  async uploadImage(imageUrl: string, conversationStyle: BingConversationStyle = BingConversationStyle.Creative): Promise<KBlobResponse | undefined> {
    if (!imageUrl) {
      return
    }
    await this.createContext(conversationStyle)
    const payload = this.buildKnowledgeApiPayload(imageUrl, conversationStyle)

    const response = await fetch(this.endpoint + '/api/kblob',
      {
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
        mode: 'cors',
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      .then(res => res.json())
      .catch(e => {
        console.log('Error', e)
      })
    return response
  }

  private async generateContent(message: ChatResponseMessage) {
    if (message.contentType === 'IMAGE') {
      this.asyncTasks.push(this.createImage(message.text, message.messageId))
    }
  }

  private async parseEvents(params: Params, events: any) {
    const conversation = this.conversationContext!

    events?.forEach(async (event: ChatUpdateCompleteResponse) => {
      debug('bing event', event)
      if (event.type === 3) {
        await Promise.all(this.asyncTasks)
          .catch(error => {
            params.onEvent({
              type: 'ERROR',
              error: error instanceof ChatError ? error : new ChatError('Catch Error', ErrorCode.UNKOWN_ERROR),
            })
          })
        this.asyncTasks = []
        params.onEvent({ type: 'UPDATE_ANSWER', data: { text: this.lastText } })
        params.onEvent({ type: 'DONE' })
        conversation.invocationId = parseInt(event.invocationId, 10) + 1
      } else if (event.type === 1) {
        const { messages, throttling } = event.arguments[0] || {}
        if (messages) {
          const message = messages[0]
          if (message.messageType === 'InternalSearchQuery' || message.messageType === 'InternalLoaderMessage') {
            return params.onEvent({ type: 'UPDATE_ANSWER', data: { text: '', progressText: message.text } })
          }
          const text = convertMessageToMarkdown(message)
          this.lastText = text
          params.onEvent({ type: 'UPDATE_ANSWER', data: { text } })
        }
        if (throttling) {
          params.onEvent({ type: 'UPDATE_ANSWER', data: { text: '', throttling } })
        }
      } else if (event.type === 2) {
        const messages = event.item.messages as ChatResponseMessage[] | undefined
        if (!messages) {
          params.onEvent({
            type: 'ERROR',
            error: new ChatError(
              event.item.result.error || 'Unknown error',
              event.item.result.value === 'Throttled' ? ErrorCode.THROTTLE_LIMIT
                : event.item.result.value === 'CaptchaChallenge' ? (this.conversationContext?.conversationId?.includes('BingProdUnAuthenticatedUsers') ? ErrorCode.BING_UNAUTHORIZED : ErrorCode.BING_CAPTCHA)
                  : ErrorCode.UNKOWN_ERROR
            ),
          })
          return
        }
        const limited = messages.some((message) =>
          message.contentOrigin === 'TurnLimiter'
          || message.messageType === 'Disengaged'
        )
        if (limited) {
          params.onEvent({
            type: 'ERROR',
            error: new ChatError(
              'Sorry, you have reached chat limit in this conversation.',
              ErrorCode.CONVERSATION_LIMIT,
            ),
          })
          return
        }

        const lastMessage = event.item.messages.at(-1) as ChatResponseMessage
        const specialMessage = event.item.messages.find(message => message.author === 'bot' && message.contentType === 'IMAGE')
        if (specialMessage) {
          this.generateContent(specialMessage)
        }

        if (lastMessage) {
          const text = convertMessageToMarkdown(lastMessage)
          this.lastText = text
          params.onEvent({
            type: 'UPDATE_ANSWER',
            data: { text, throttling: event.item.throttling, suggestedResponses: lastMessage.suggestedResponses, sourceAttributions: lastMessage.sourceAttributions },
          })
        }
      }
    })
  }

  resetConversation() {
    this.conversationContext = undefined
  }
}
