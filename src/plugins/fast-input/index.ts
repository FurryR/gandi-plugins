import WorkspaceQuerier from "./WorkspaceQuerier.js";
import renderBlock, { getBlockHeight } from "./BlockRenderer.js";
import { BlockTypeInfo } from "./BlockTypeInfo.js";
import { onClearTextWidthCache } from "./module.js";
import "./compatibility.css";
import "./styles.css";
import FastInputIcon from "assets/icon--fast-input.svg";
import React from "react";

const FastInput = (apis: PluginContext) => {
  const ScratchBlocks = apis.blockly;
  const vm = apis.vm;

  const PREVIEW_LIMIT = 50;

  const popupRoot = document.body.appendChild(document.createElement("div"));
  popupRoot.classList.add("sa-mcp-root");
  popupRoot.dir = "ltr";
  popupRoot.style.display = "none";

  const popupContainer = popupRoot.appendChild(document.createElement("div"));
  popupContainer.classList.add("sa-mcp-container");

  const popupInputContainer = popupContainer.appendChild(document.createElement("div"));
  popupInputContainer.classList.add("sa-mcp-input-wrapper");

  const popupInputSuggestion = popupInputContainer.appendChild(document.createElement("input"));
  popupInputSuggestion.classList.add("sa-mcp-input-suggestion");

  const popupInput = popupInputContainer.appendChild(document.createElement("input"));
  popupInput.classList.add("sa-mcp-input");
  popupInput.setAttribute("autocomplete", "off");

  const popupPreviewContainer = popupContainer.appendChild(document.createElement("div"));
  popupPreviewContainer.classList.add("sa-mcp-preview-container");

  const popupPreviewScrollbarSVG = popupContainer.appendChild(
    document.createElementNS("http://www.w3.org/2000/svg", "svg"),
  );
  popupPreviewScrollbarSVG.classList.add(
    "sa-mcp-preview-scrollbar",
    "blocklyScrollbarVertical",
    "blocklyMainWorkspaceScrollbar",
  );
  popupPreviewScrollbarSVG.style.display = "none";

  const popupPreviewScrollbarBackground = popupPreviewScrollbarSVG.appendChild(
    document.createElementNS("http://www.w3.org/2000/svg", "rect"),
  );
  popupPreviewScrollbarBackground.setAttribute("width", "11");
  popupPreviewScrollbarBackground.classList.add("blocklyScrollbarBackground");

  const popupPreviewScrollbarHandle = popupPreviewScrollbarSVG.appendChild(
    document.createElementNS("http://www.w3.org/2000/svg", "rect"),
  );
  popupPreviewScrollbarHandle.setAttribute("rx", "3");
  popupPreviewScrollbarHandle.setAttribute("ry", "3");
  popupPreviewScrollbarHandle.setAttribute("width", "6");
  popupPreviewScrollbarHandle.setAttribute("x", "2.5");
  popupPreviewScrollbarHandle.classList.add("blocklyScrollbarHandle");

  const popupPreviewBlocks = popupPreviewContainer.appendChild(
    document.createElementNS("http://www.w3.org/2000/svg", "svg"),
  );
  popupPreviewBlocks.classList.add("sa-mcp-preview-blocks");

  const querier = new WorkspaceQuerier();

  let mousePosition = { x: 0, y: 0 };
  document.addEventListener("mousemove", (e) => {
    mousePosition = { x: e.clientX, y: e.clientY };
  });

  onClearTextWidthCache(closePopup);

  /**
   * @typedef ResultPreview
   * @property {BlockInstance} block
   * @property {((endOnly: boolean) => string)?} autocompleteFactory
   * @property {BlockComponent} renderedBlock
   * @property {SVGGElement} svgBlock
   * @property {SVGRectElement} svgBackground
   */
  /** @type {ResultPreview[]} */
  const queryPreviews = [];
  /** @type {QueryResult | null} */
  let queryIllegalResult = null;
  let selectedPreviewIdx = 0;
  /** @type {BlockTypeInfo[]?} */
  let blockTypes = null;
  let limited = false;

  let allowMenuClose = true;

  let popupPosition = null;
  let popupOrigin = null;

  let previewWidth = 0;
  let previewHeight = 0;

  let previewScale = 0;

  const previewMinHeight = 0;
  let previewMaxHeight = 0;

  let disabled = false;

  let settingPopupScale = 48;
  let settingPopupWidth = 25;
  let settingPopupMaxHeight = 40;

  function openPopup() {
    if (disabled) return;

    // Don't show the menu if we're not in the code editor
    // if (addon.tab.editorMode !== "editor") return;
    // if (addon.tab.redux.state.scratchGui.editorTab.activeTabIndex !== 0) return;

    blockTypes = BlockTypeInfo.getBlocks(Blockly, vm, ScratchBlocks.getMainWorkspace(), apis.msg);
    querier.indexWorkspace([...blockTypes]);
    blockTypes.sort((a, b) => {
      const prio = (block) => ["operators", "data"].indexOf(block.category.name) - block.id.startsWith("data_");
      return prio(b) - prio(a);
    });

    previewScale = window.innerWidth * 0.00005 + settingPopupScale / 100;
    previewWidth = (window.innerWidth * settingPopupWidth) / 100;
    previewMaxHeight = (window.innerHeight * settingPopupMaxHeight) / 100;

    popupContainer.style.width = previewWidth + "px";

    popupOrigin = { x: mousePosition.x, y: mousePosition.y };
    popupRoot.style.display = "";
    popupInput.value = "";
    popupInput.focus();
    updateInput();
  }

  function closePopup() {
    if (allowMenuClose) {
      popupOrigin = null;
      popupPosition = null;
      popupRoot.style.display = "none";
      blockTypes = null;
      querier.clearWorkspaceIndex();
    }
  }

  popupInput.addEventListener("input", updateInput);

  function updateInput() {
    /**
     * @typedef MenuItem
     * @property {BlockInstance} block
     * @property {(endOnly: boolean) => string} [autocompleteFactory]
     */
    /** @type {MenuItem[]} */
    const blockList = [];

    if (popupInput.value.trim().length === 0) {
      queryIllegalResult = null;
      if (blockTypes)
        for (const blockType of blockTypes) {
          blockList.push({
            block: blockType.createBlock(),
          });
        }
      limited = false;
    } else {
      // Get the list of blocks to display using the input content
      const queryResultObj = querier.queryWorkspace(popupInput.value);
      const queryResults = queryResultObj.results;
      queryIllegalResult = queryResultObj.illegalResult;
      limited = queryResultObj.limited;

      if (queryResults.length > PREVIEW_LIMIT) queryResults.length = PREVIEW_LIMIT;

      for (const queryResult of queryResults) {
        blockList.push({
          block: queryResult.getBlock(),
          autocompleteFactory: (endOnly) => queryResult.toText(endOnly),
        });
      }
    }

    // @ts-ignore Delete the old previews
    while (popupPreviewBlocks.firstChild) popupPreviewBlocks.removeChild(popupPreviewBlocks.lastChild);

    // Create the new previews
    queryPreviews.length = 0;
    let y = 0;
    for (let resultIdx = 0; resultIdx < blockList.length; resultIdx++) {
      const result = blockList[resultIdx];

      const mouseMoveListener = () => {
        updateSelection(resultIdx);
      };

      const mouseDownListener = (e) => {
        e.stopPropagation();
        e.preventDefault();
        updateSelection(resultIdx);
        allowMenuClose = !e.shiftKey;
        selectBlock();
        allowMenuClose = true;
        if (e.shiftKey) popupInput.focus();
      };

      const svgBackground = popupPreviewBlocks.appendChild(
        document.createElementNS("http://www.w3.org/2000/svg", "rect"),
      );

      const height = getBlockHeight(result.block);
      svgBackground.setAttribute("transform", `translate(0, ${(y + height / 10) * previewScale})`);
      svgBackground.setAttribute("height", height * previewScale + "px");
      svgBackground.classList.add("sa-mcp-preview-block-bg");
      svgBackground.addEventListener("mousemove", mouseMoveListener);
      svgBackground.addEventListener("mousedown", mouseDownListener);

      const svgBlock = popupPreviewBlocks.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "g"));
      svgBlock.addEventListener("mousemove", mouseMoveListener);
      svgBlock.addEventListener("mousedown", mouseDownListener);
      svgBlock.classList.add("sa-mcp-preview-block");

      const renderedBlock = renderBlock(result.block, svgBlock);

      queryPreviews.push({
        block: result.block,
        autocompleteFactory: result.autocompleteFactory ?? null,
        renderedBlock,
        svgBlock,
        svgBackground,
      });

      y += height;
    }

    const height = (y + 8) * previewScale;

    if (height < previewMinHeight) previewHeight = previewMinHeight;
    else if (height > previewMaxHeight) previewHeight = previewMaxHeight;
    else previewHeight = height;

    popupPreviewBlocks.setAttribute("height", `${height}px`);
    popupPreviewContainer.style.height = previewHeight + "px";
    popupPreviewScrollbarSVG.style.height = previewHeight + "px";
    popupPreviewScrollbarBackground.setAttribute("height", "" + previewHeight);
    popupInputContainer.dataset["error"] = "" + limited;

    popupPosition = { x: popupOrigin.x + 16, y: popupOrigin.y - 8 };

    const popupHeight = popupContainer.getBoundingClientRect().height;
    const popupBottom = popupPosition.y + popupHeight;
    if (popupBottom > window.innerHeight) {
      popupPosition.y -= popupBottom - window.innerHeight;
    }

    popupRoot.style.top = popupPosition.y + "px";
    popupRoot.style.left = popupPosition.x + "px";

    selectedPreviewIdx = -1;
    updateSelection(0);
    updateCursor();
    updateScrollbar();
  }

  function updateSelection(newIdx) {
    if (selectedPreviewIdx === newIdx) return;

    const oldSelection = queryPreviews[selectedPreviewIdx];
    if (oldSelection) {
      oldSelection.svgBackground.classList.remove("sa-mcp-preview-block-bg-selection");
      oldSelection.svgBlock.classList.remove("sa-mcp-preview-block-selection");
    }

    if (queryPreviews.length === 0 && queryIllegalResult) {
      popupInputSuggestion.value =
        popupInput.value + queryIllegalResult.toText(true).substring(popupInput.value.length);
      return;
    }

    const newSelection = queryPreviews[newIdx];
    if (newSelection && newSelection.autocompleteFactory) {
      newSelection.svgBackground.classList.add("sa-mcp-preview-block-bg-selection");
      newSelection.svgBlock.classList.add("sa-mcp-preview-block-selection");

      newSelection.svgBackground.scrollIntoView({
        block: "nearest",
        behavior: Math.abs(newIdx - selectedPreviewIdx) > 1 ? "smooth" : "auto",
      });

      popupInputSuggestion.value =
        popupInput.value + newSelection.autocompleteFactory(true).substring(popupInput.value.length);
    } else {
      popupInputSuggestion.value = "";
    }

    selectedPreviewIdx = newIdx;
  }

  // @ts-ignore
  document.addEventListener("selectionchange", updateCursor);

  function updateCursor() {
    const cursorPos = popupInput.selectionStart ?? 0;
    const cursorPosRel = popupInput.value.length === 0 ? 0 : cursorPos / popupInput.value.length;

    let y = 0;
    for (let previewIdx = 0; previewIdx < queryPreviews.length; previewIdx++) {
      const preview = queryPreviews[previewIdx];

      let blockX = 5;
      if (blockX + preview.renderedBlock.width > previewWidth / previewScale)
        blockX += (previewWidth / previewScale - blockX - preview.renderedBlock.width) * previewScale * cursorPosRel;
      const blockY = (y + 30) * previewScale;

      preview.svgBlock.setAttribute("transform", `translate(${blockX}, ${blockY}) scale(${previewScale})`);

      y += getBlockHeight(preview.block);
    }

    popupInputSuggestion.scrollLeft = popupInput.scrollLeft;
  }

  popupPreviewContainer.addEventListener("scroll", updateScrollbar);

  function updateScrollbar() {
    const scrollTop = popupPreviewContainer.scrollTop;
    const scrollY = popupPreviewContainer.scrollHeight;

    if (scrollY <= previewHeight) {
      popupPreviewScrollbarSVG.style.display = "none";
      return;
    }

    const scrollbarHeight = (previewHeight / scrollY) * previewHeight;
    const scrollbarY = (scrollTop / scrollY) * previewHeight;

    popupPreviewScrollbarSVG.style.display = "";
    popupPreviewScrollbarHandle.setAttribute("height", "" + scrollbarHeight);
    popupPreviewScrollbarHandle.setAttribute("y", "" + scrollbarY);
  }

  function selectBlock() {
    const selectedPreview = queryPreviews[selectedPreviewIdx];
    if (!selectedPreview) return;

    const workspace = ScratchBlocks.getMainWorkspace();
    // This is mostly copied from https://github.com/scratchfoundation/scratch-blocks/blob/893c7e7ad5bfb416eaed75d9a1c93bdce84e36ab/core/scratch_blocks_utils.js#L171
    // Some bits were removed or changed to fit our needs.
    workspace.setResizesEnabled(false);

    let newBlock;
    ScratchBlocks.Events.disable();
    try {
      newBlock = selectedPreview.block.createWorkspaceForm();
      ScratchBlocks.scratchBlocksUtils.changeObscuredShadowIds(newBlock);

      const svgRootNew = newBlock.getSvgRoot();
      if (!svgRootNew) {
        throw new Error("newBlock is not rendered.");
      }

      const blockBounds = newBlock.svgPath_.getBoundingClientRect();
      const newBlockX = Math.floor((mousePosition.x - (blockBounds.left + blockBounds.right) / 2) / workspace.scale);
      const newBlockY = Math.floor((mousePosition.y - (blockBounds.top + blockBounds.bottom) / 2) / workspace.scale);
      newBlock.moveBy(newBlockX, newBlockY);
    } finally {
      ScratchBlocks.Events.enable();
    }
    if (ScratchBlocks.Events.isEnabled()) {
      ScratchBlocks.Events.fire(new ScratchBlocks.Events.BlockCreate(newBlock));
    }

    const fakeEvent = {
      clientX: mousePosition.x,
      clientY: mousePosition.y,
      type: "mousedown",
      stopPropagation: function () { },
      preventDefault: function () { },
      target: selectedPreview.svgBlock,
    };
    if (workspace.getGesture(fakeEvent)) {
      workspace.startDragWithFakeEvent(fakeEvent, newBlock);
    }
  }

  function acceptAutocomplete() {
    let factory;
    if (queryPreviews[selectedPreviewIdx]) factory = queryPreviews[selectedPreviewIdx].autocompleteFactory;
    else factory = () => popupInputSuggestion.value;
    if (popupInputSuggestion.value.length === 0 || !factory) return;
    popupInput.value = factory(false);
    // Move cursor to the end of the newly inserted text
    popupInput.selectionStart = popupInput.value.length + 1;
    updateInput();
  }

  popupInput.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "Escape":
        // If there's something in the input, clear it
        if (popupInput.value.length > 0) {
          popupInput.value = "";
          updateInput();
        } else {
          // If not, close the menu
          closePopup();
        }
        e.stopPropagation();
        e.preventDefault();
        break;
      case "Tab":
        acceptAutocomplete();
        e.stopPropagation();
        e.preventDefault();
        break;
      case "Enter":
        selectBlock();
        closePopup();
        e.stopPropagation();
        e.preventDefault();
        break;
      case "ArrowDown":
        if (selectedPreviewIdx + 1 >= queryPreviews.length) updateSelection(0);
        else updateSelection(selectedPreviewIdx + 1);
        e.stopPropagation();
        e.preventDefault();
        break;
      case "ArrowUp":
        if (selectedPreviewIdx - 1 < 0) updateSelection(queryPreviews.length - 1);
        else updateSelection(selectedPreviewIdx - 1);
        e.stopPropagation();
        e.preventDefault();
        break;
    }
  });

  popupInput.addEventListener("focusout", closePopup);

  // // Open on ctrl + space
  // document.addEventListener("keydown", (e) => {
  //   if (e.key === " " && (e.ctrlKey || e.metaKey)) {
  //     openPopup();
  //     e.preventDefault();
  //     e.stopPropagation();
  //   }
  // });

  // Open on mouse wheel button
  const _doWorkspaceClick_ = ScratchBlocks.Gesture.prototype.doWorkspaceClick_;
  ScratchBlocks.Gesture.prototype.doWorkspaceClick_ = function () {
    if (this.mostRecentEvent_.button === 1 || this.mostRecentEvent_.shiftKey) openPopup();
    mousePosition = { x: this.mostRecentEvent_.clientX, y: this.mostRecentEvent_.clientY };
    _doWorkspaceClick_.call(this);
  };

  // The popup should delete blocks dragged ontop of it
  const _isDeleteArea = ScratchBlocks.WorkspaceSvg.prototype.isDeleteArea;
  ScratchBlocks.WorkspaceSvg.prototype.isDeleteArea = function (e) {
    if (popupPosition) {
      if (
        e.clientX > popupPosition.x &&
        e.clientX < popupPosition.x + previewWidth &&
        e.clientY > popupPosition.y &&
        e.clientY < popupPosition.y + previewHeight
      ) {
        return ScratchBlocks.DELETE_AREA_TOOLBOX;
      }
    }
    return _isDeleteArea.call(this, e);
  };

  const register = apis.registerSettings(
    apis.msg("plugins.fastInput.title"),
    "plugin-fast-input",
    [
      {
        key: "fastInput",
        label: apis.msg("plugins.fastInput.title"),
        description: apis.msg("plugins.fastInput.description"),
        items: [
          {
            key: "popup_scale",
            label: apis.msg("plugins.fastInput.popup_scale"),
            type: "input",
            inputProps: {
              type: "number",
            },
            value: 48,
            onChange: (value: number) => {
              settingPopupScale = value;
            },
          },
          {
            key: "popup_width",
            label: apis.msg("plugins.fastInput.popup_width"),
            type: "input",
            inputProps: {
              type: "number",
            },
            value: 25,
            onChange: (value: number) => {
              settingPopupWidth = value;
            },
          },
          {
            key: "popup_max_height",
            label: apis.msg("plugins.fastInput.popup_max_height"),
            type: "input",
            inputProps: {
              type: "number",
            },
            value: 40,
            onChange: (value: number) => {
              settingPopupMaxHeight = value;
            },
          },
        ],
      },
    ],
    React.createElement(FastInputIcon),
  );

  return {
    dispose: () => {
      disabled = true;
      register.dispose();
    },
  };
};

export default FastInput;
