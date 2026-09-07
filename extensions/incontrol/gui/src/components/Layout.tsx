import { useContext, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { CustomScrollbarDiv } from ".";
import { AuthProvider } from "../context/Auth";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { LocalStorageProvider } from "../context/LocalStorage";
import { useWebviewListener } from "../hooks/useWebviewListener";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { setCodeToEdit } from "../redux/slices/editState";
import { setShowDialog } from "../redux/slices/uiSlice";
import { enterEdit, exitEdit } from "../redux/thunks/edit";
import { saveCurrentSession } from "../redux/thunks/session";
import { fontSize, isMetaEquivalentKeyPressed } from "../util";
import { CONFIG_ROUTES, ROUTES } from "../util/navigation";
import { FatalErrorIndicator } from "./config/FatalErrorNotice";
import TextDialog from "./dialogs";
import { useMainEditor } from "./mainInput/TipTapEditor";
import OSRContextMenu from "./OSRContextMenu";

const LayoutTopDiv = styled(CustomScrollbarDiv)`
  height: 100%;
  position: relative;
  overflow-x: hidden;
`;

const GridDiv = styled.div`
  display: grid;
  grid-template-rows: 1fr auto;
  /* 只有 1fr 的话，列轨道会按内容的 min-content 撑开：输入框工具栏那一行
   * （两个下拉 + 三个图标 + 快捷键 + 发送按钮）在窄侧栏里比窗口还宽，于是整页
   * 轨道被顶宽、右侧溢出，面板越窄溢出越多。minmax(0,1fr) 关掉这个行为。 */
  grid-template-columns: minmax(0, 1fr);
  max-width: 100%;
  height: 100vh;
  overflow-x: visible;
`;

const Layout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);

  const { mainEditor } = useMainEditor();
  const dialogMessage = useAppSelector((state) => state.ui.dialogMessage);

  const showDialog = useAppSelector((state) => state.ui.showDialog);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const isHome =
    location.pathname === ROUTES.HOME ||
    location.pathname === ROUTES.HOME_INDEX;

  useWebviewListener(
    "newSession",
    async () => {
      navigate(ROUTES.HOME);
      if (isInEdit) {
        await dispatch(exitEdit({}));
      } else {
        await dispatch(
          saveCurrentSession({
            openNewSession: true,
            generateTitle: true,
          })
        );
      }
    },
    [isInEdit]
  );

  useWebviewListener(
    "isIncontrolInputFocused",
    async () => {
      return false;
    },
    [isHome],
    isHome
  );

  useWebviewListener(
    "focusIncontrolInputWithNewSession",
    async () => {
      navigate(ROUTES.HOME);
      if (isInEdit) {
        await dispatch(
          exitEdit({
            openNewSession: true,
          })
        );
      } else {
        await dispatch(
          saveCurrentSession({
            openNewSession: true,
            generateTitle: true,
          })
        );
      }
    },
    [isHome, isInEdit],
    isHome
  );

  useWebviewListener(
    "addModel",
    async () => {
      // Models are added by editing config.yaml; the Models tab explains how.
      navigate(CONFIG_ROUTES.MODELS);
    },
    [navigate]
  );

  useWebviewListener(
    "navigateTo",
    async (data) => {
      if (data.toggle && location.pathname === data.path) {
        navigate("/");
      } else {
        navigate(data.path);
      }
    },
    [location, navigate]
  );

  useWebviewListener(
    "focusEdit",
    async () => {
      await ideMessenger.request("edit/addCurrentSelection", undefined);
      await dispatch(enterEdit({ editorContent: mainEditor?.getJSON() }));
      mainEditor?.commands.focus();
    },
    [ideMessenger, mainEditor]
  );

  useWebviewListener(
    "setCodeToEdit",
    async (payload) => {
      dispatch(
        setCodeToEdit({
          codeToEdit: payload,
        })
      );
    },
    []
  );

  useWebviewListener(
    "exitEditMode",
    async () => {
      await dispatch(exitEdit({}));
    },
    []
  );

  useEffect(() => {
    const handleKeyDown = (event: any) => {
      if (isMetaEquivalentKeyPressed(event) && event.code === "KeyC") {
        const selection = window.getSelection()?.toString();
        if (selection) {
          setTimeout(() => {
            void navigator.clipboard.writeText(selection);
          }, 100);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <LocalStorageProvider>
      <AuthProvider>
        <LayoutTopDiv>
          <OSRContextMenu />
          <div
            style={{
              scrollbarGutter: "stable both-edges",
              minHeight: "100%",
              minWidth: 0,
              maxWidth: "100%",
              display: "grid",
              gridTemplateRows: "1fr auto",
              // 同上：轨道必须允许收缩，否则窄面板里被内容撑宽
              gridTemplateColumns: "minmax(0, 1fr)",
            }}
          >
            <TextDialog
              showDialog={showDialog}
              onEnter={() => {
                dispatch(setShowDialog(false));
              }}
              onClose={() => {
                dispatch(setShowDialog(false));
              }}
              message={dialogMessage}
            />

            <GridDiv>
              <Outlet />
              {/* The fatal error for chat is shown below input */}
              {!isHome && <FatalErrorIndicator />}
            </GridDiv>
          </div>
          <div style={{ fontSize: fontSize(-4) }} id="tooltip-portal-div" />
        </LayoutTopDiv>
      </AuthProvider>
    </LocalStorageProvider>
  );
};

export default Layout;
