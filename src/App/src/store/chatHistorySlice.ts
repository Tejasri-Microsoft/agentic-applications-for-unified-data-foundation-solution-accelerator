import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import type { Conversation, ChatMessage } from "../types/AppTypes";
import { historyList, historyRead, historyDeleteAll, historyDelete, historyUpdate, historyRename } from "../api/api";
let isUpdateConversationInFlight = false;
export interface ChatHistoryState {
  list: Conversation[];
  fetchingConversations: boolean;
  isFetchingConvMessages: boolean;
  isHistoryUpdateAPIPending: boolean;
}

const initialState: ChatHistoryState = {
  list: [],
  fetchingConversations: false,
  isFetchingConvMessages: false,
  isHistoryUpdateAPIPending: false,
};

// Async Thunks
export const fetchChatHistory = createAsyncThunk(
  "chatHistory/fetchList",
  async (offset: number = 0) => {
    const response = await historyList(offset);
    return { conversations: response, offset };
  },
  {
    condition: (offset, { getState }) => {
      const { chatHistory } = getState() as { chatHistory: ChatHistoryState };
      // Don't fetch if already fetching
      if (chatHistory.fetchingConversations) {
        return false;
      }
      return true;
    },
  }
);

export const fetchConversationMessages = createAsyncThunk(
  "chatHistory/fetchConversation",
  async (conversationId: string) => {
    const response = await historyRead(conversationId);
    return { conversationId, messages: response };
  }
);

export const deleteAllConversations = createAsyncThunk(
  "chatHistory/deleteAll",
  async () => {
    await historyDeleteAll();
    return null;
  }
);

export const deleteConversation = createAsyncThunk(
  "chatHistory/deleteOne",
  async (conversationId: string) => {
    await historyDelete(conversationId);
    return conversationId;
  }
);

export const updateConversation = createAsyncThunk(
  "chatHistory/update",
  async (
    { conversationId, messages }: { conversationId: string; messages: ChatMessage[] },
    { rejectWithValue }
  ) => {
    if (isUpdateConversationInFlight) {
      return rejectWithValue("Update already in progress");
    }

    isUpdateConversationInFlight = true;

    try {
      const response = await historyUpdate(messages, conversationId);
      const responseJson = await response.json();

      return { ...responseJson, messages };
    } catch (error) {
      return rejectWithValue(error);
    } finally {
      isUpdateConversationInFlight = false;
    }
  }
);

export const renameConversation = createAsyncThunk(
  "chatHistory/rename",
  async ({ conversationId, newTitle }: { conversationId: string; newTitle: string }) => {
    await historyRename(conversationId, newTitle);
    return { conversationId, newTitle };
  }
);

const chatHistorySlice = createSlice({
  name: "chatHistory",
  initialState,
  reducers: {
    addConversations: (state, action: PayloadAction<Conversation[]>) => {
      const incoming = action.payload;

      const map = new Map<string, Conversation>();

      // Keep existing
      state.list.forEach((c) => {
        if (c.id) map.set(c.id, c);
      });

      // Overwrite with incoming (latest wins)
      incoming.forEach((c) => {
        if (c.id) map.set(c.id, c);
      });

      state.list = Array.from(map.values());
    },
    addNewConversation: (state, action: PayloadAction<Conversation>) => {
      const incoming = action.payload;

      if (!incoming?.id) return;

      // Remove any existing duplicate
      state.list = state.list.filter((c) => c.id !== incoming.id);

      // Insert fresh at top
      state.list.unshift(incoming);
    },
    updateConversationTitle: (state, action: PayloadAction<{ id: string; newTitle: string }>) => {
      const index = state.list.findIndex((obj) => obj.id === action.payload.id);
      if (index > -1) {
        state.list[index].title = action.payload.newTitle;
      }
    },
    showConversationMessages: (state, action: PayloadAction<{ id: string; messages: ChatMessage[] }>) => {
      const matchedIndex = state.list.findIndex((obj) => obj.id === action.payload.id);
      if (matchedIndex > -1) {
        state.list[matchedIndex].messages = action.payload.messages;
      }
    },
    setFetchingConversations: (state, action: PayloadAction<boolean>) => {
      state.fetchingConversations = action.payload;
    },
    setFetchingConvMessages: (state, action: PayloadAction<boolean>) => {
      state.isFetchingConvMessages = action.payload;
    },
    setHistoryUpdateAPIPending: (state, action: PayloadAction<boolean>) => {
      state.isHistoryUpdateAPIPending = action.payload;
    },
    clearAll: (state) => {
      state.list = [];
    },
    clearConversationList: (state) => {
      state.list = [];
    },
  },
  extraReducers: (builder) => {
    // Fetch Chat History
    builder.addCase(fetchChatHistory.pending, (state) => {
      state.fetchingConversations = true;
    });
    builder.addCase(fetchChatHistory.fulfilled, (state, action) => {
      if (action.payload) {
        const { conversations, offset } = action.payload;
        if (offset === 0) {
          // Replace list for initial fetch
          state.list = conversations || [];
        } else {
          // Append for pagination, dedup by id
          if (conversations) {
            const existingIds = new Set(state.list.map((c) => c.id).filter(Boolean));
            const newConversations = conversations.filter((c) => !existingIds.has(c.id));
            state.list.push(...newConversations);
          }
        }
      }
      state.fetchingConversations = false;
    });
    builder.addCase(fetchChatHistory.rejected, (state) => {
      state.fetchingConversations = false;
    });

    // Fetch Conversation Messages
    builder.addCase(fetchConversationMessages.pending, (state) => {
      state.isFetchingConvMessages = true;
    });
    builder.addCase(fetchConversationMessages.fulfilled, (state, action) => {
      const { conversationId, messages } = action.payload;
      const matchedIndex = state.list.findIndex((obj) => obj.id === conversationId);
      if (matchedIndex > -1) {
        state.list[matchedIndex].messages = messages;
      }
      state.isFetchingConvMessages = false;
    });
    builder.addCase(fetchConversationMessages.rejected, (state) => {
      state.isFetchingConvMessages = false;
    });

    // Delete All Conversations
    builder.addCase(deleteAllConversations.fulfilled, (state) => {
      state.list = [];
    });

    // Delete Single Conversation
    builder.addCase(deleteConversation.fulfilled, (state, action) => {
      state.list = state.list.filter((conversation) => conversation.id !== action.payload);
    });

    // Update Conversation
    builder.addCase(updateConversation.pending, (state) => {
      state.isHistoryUpdateAPIPending = true;
    });
    builder.addCase(updateConversation.fulfilled, (state, action) => {
  state.isHistoryUpdateAPIPending = false;

  const { data, messages } = action.payload || {};
  const conversationId = data?.conversation_id;

  if (!conversationId) return;

  const index = state.list.findIndex((c) => c.id === conversationId);

  if (index > -1) {
    state.list[index].messages = messages;
    state.list[index].updatedAt = data?.date;
  }
});
    builder.addCase(updateConversation.rejected, (state) => {
      state.isHistoryUpdateAPIPending = false;
    });

    // Rename Conversation
    builder.addCase(renameConversation.fulfilled, (state, action) => {
      const { conversationId, newTitle } = action.payload;
      const index = state.list.findIndex((obj) => obj.id === conversationId);
      if (index > -1) {
        state.list[index].title = newTitle;
      }
    });
  },
});

export const {
  addConversations,
  addNewConversation,
  updateConversationTitle,
  showConversationMessages,
  setFetchingConversations,
  setFetchingConvMessages,
  clearAll,
  clearConversationList,
} = chatHistorySlice.actions;

export default chatHistorySlice.reducer;
