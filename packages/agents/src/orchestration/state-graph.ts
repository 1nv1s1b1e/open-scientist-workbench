export const GRAPH_END = '__end__' as const

export type GraphEnd = typeof GRAPH_END
export type GraphTarget = string | GraphEnd

export type GraphEvent =
  | {
      type: 'node-start' | 'node-complete'
      node: string
      step: number
      attempt: number
    }
  | {
      type: 'node-retry' | 'node-error'
      node: string
      step: number
      attempt: number
      error: unknown
    }
  | {
      type: 'node-message'
      node: string
      step: number
      attempt: number
      data: unknown
    }
  | {
      type: 'graph-end'
      node: string | null
      step: number
      attempt: number
    }

export interface GraphNodeContext {
  node: string
  step: number
  attempt: number
  signal?: AbortSignal
  emit: (data: unknown) => Promise<void>
}

export type GraphNode<TState extends object> = (
  state: Readonly<TState>,
  context: GraphNodeContext,
) => Partial<TState> | void | Promise<Partial<TState> | void>

export interface GraphNodeOptions {
  maxAttempts?: number
  shouldRetry?: (error: unknown) => boolean
}

export interface GraphCheckpoint<TState extends object> {
  currentNode: string
  nextNode: GraphTarget
  step: number
  state: TState
}

export interface GraphRunOptions<TState extends object> {
  startAt?: GraphTarget
  maxSteps?: number
  signal?: AbortSignal
  onEvent?: (event: GraphEvent) => void | Promise<void>
  checkpoint?: (checkpoint: GraphCheckpoint<TState>) => void | Promise<void>
}

export interface GraphRunResult<TState extends object> {
  state: TState
  steps: number
  lastNode: string | null
}

type GraphRouter<TState extends object> = (
  state: Readonly<TState>,
) => GraphTarget | Promise<GraphTarget>

interface NodeDefinition<TState extends object> {
  handler: GraphNode<TState>
  maxAttempts: number
  shouldRetry: (error: unknown) => boolean
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('state graph execution aborted')
  }
}

export class StateGraph<TState extends object> {
  private readonly nodes = new Map<string, NodeDefinition<TState>>()
  private readonly edges = new Map<string, GraphTarget>()
  private readonly routers = new Map<string, GraphRouter<TState>>()
  private entryPoint: string | null = null

  addNode(name: string, handler: GraphNode<TState>, options: GraphNodeOptions = {}): this {
    if (!name || name === GRAPH_END) {
      throw new Error('graph node name must be non-empty and cannot be GRAPH_END')
    }
    if (this.nodes.has(name)) {
      throw new Error(`graph node already exists: ${name}`)
    }
    const maxAttempts = options.maxAttempts ?? 1
    assertPositiveInteger(maxAttempts, `maxAttempts for ${name}`)
    this.nodes.set(name, {
      handler,
      maxAttempts,
      shouldRetry: options.shouldRetry ?? (() => true),
    })
    return this
  }

  setEntryPoint(name: string): this {
    this.entryPoint = name
    return this
  }

  addEdge(from: string, to: GraphTarget): this {
    if (this.routers.has(from)) {
      throw new Error(`conditional edges already exist for node: ${from}`)
    }
    this.edges.set(from, to)
    return this
  }

  addConditionalEdges(from: string, router: GraphRouter<TState>): this {
    if (this.edges.has(from)) {
      throw new Error(`static edge already exists for node: ${from}`)
    }
    this.routers.set(from, router)
    return this
  }

  compile(): CompiledStateGraph<TState> {
    const entryPoint = this.entryPoint
    if (!entryPoint) throw new Error('graph entry point is not configured')
    if (!this.nodes.has(entryPoint)) {
      throw new Error(`graph entry point does not exist: ${entryPoint}`)
    }
    for (const name of this.nodes.keys()) {
      if (!this.edges.has(name) && !this.routers.has(name)) {
        throw new Error(`graph node has no outgoing route: ${name}`)
      }
    }
    for (const [from, target] of this.edges) {
      if (!this.nodes.has(from)) {
        throw new Error(`edge source does not exist: ${from}`)
      }
      if (target !== GRAPH_END && !this.nodes.has(target)) {
        throw new Error(`edge target does not exist: ${target}`)
      }
    }
    for (const from of this.routers.keys()) {
      if (!this.nodes.has(from)) {
        throw new Error(`conditional edge source does not exist: ${from}`)
      }
    }
    return new CompiledStateGraph(
      new Map(this.nodes),
      new Map(this.edges),
      new Map(this.routers),
      entryPoint,
    )
  }
}

export class CompiledStateGraph<TState extends object> {
  constructor(
    private readonly nodes: ReadonlyMap<string, NodeDefinition<TState>>,
    private readonly edges: ReadonlyMap<string, GraphTarget>,
    private readonly routers: ReadonlyMap<string, GraphRouter<TState>>,
    private readonly entryPoint: string,
  ) {}

  async run(
    initialState: TState,
    options: GraphRunOptions<TState> = {},
  ): Promise<GraphRunResult<TState>> {
    const maxSteps = options.maxSteps ?? 100
    assertPositiveInteger(maxSteps, 'maxSteps')
    let currentTarget = options.startAt ?? this.entryPoint
    let state = { ...initialState }
    let steps = 0
    let lastNode: string | null = null

    const dispatch = async (event: GraphEvent): Promise<void> => {
      await options.onEvent?.(event)
    }

    if (currentTarget === GRAPH_END) {
      await dispatch({ type: 'graph-end', node: null, step: 0, attempt: 0 })
      return { state, steps, lastNode }
    }

    while (currentTarget !== GRAPH_END) {
      throwIfAborted(options.signal)
      if (steps >= maxSteps) {
        throw new Error(`state graph exceeded maximum step count (${maxSteps})`)
      }
      const nodeName: string = currentTarget
      const definition = this.nodes.get(nodeName)
      if (!definition) throw new Error(`graph node does not exist: ${nodeName}`)

      let nextState = state
      let nextTarget: GraphTarget | null = null
      for (let attempt = 1; attempt <= definition.maxAttempts; attempt += 1) {
        throwIfAborted(options.signal)
        await dispatch({
          type: 'node-start',
          node: nodeName,
          step: steps + 1,
          attempt,
        })
        try {
          const context: GraphNodeContext = {
            node: nodeName,
            step: steps + 1,
            attempt,
            emit: async (data) => {
              await dispatch({
                type: 'node-message',
                node: nodeName,
                step: steps + 1,
                attempt,
                data,
              })
            },
            ...(options.signal ? { signal: options.signal } : {}),
          }
          const patch = await definition.handler(state, context)
          nextState = patch ? { ...state, ...patch } : state
          const router = this.routers.get(nodeName)
          nextTarget = router ? await router(nextState) : (this.edges.get(nodeName) ?? null)
          if (!nextTarget) {
            throw new Error(`graph node has no outgoing route: ${nodeName}`)
          }
          if (nextTarget !== GRAPH_END && !this.nodes.has(nextTarget)) {
            throw new Error(`graph route target does not exist: ${nextTarget}`)
          }
          await dispatch({
            type: 'node-complete',
            node: nodeName,
            step: steps + 1,
            attempt,
          })
          break
        } catch (error) {
          const canRetry = attempt < definition.maxAttempts && definition.shouldRetry(error)
          if (canRetry) {
            await dispatch({
              type: 'node-retry',
              node: nodeName,
              step: steps + 1,
              attempt,
              error,
            })
            continue
          }
          await dispatch({
            type: 'node-error',
            node: nodeName,
            step: steps + 1,
            attempt,
            error,
          })
          throw error
        }
      }

      if (!nextTarget) {
        throw new Error(`graph node did not produce a route: ${nodeName}`)
      }
      steps += 1
      lastNode = nodeName
      state = nextState
      await options.checkpoint?.({
        currentNode: nodeName,
        nextNode: nextTarget,
        step: steps,
        state: { ...state },
      })
      currentTarget = nextTarget
    }

    await dispatch({
      type: 'graph-end',
      node: lastNode,
      step: steps,
      attempt: 0,
    })
    return { state, steps, lastNode }
  }
}
